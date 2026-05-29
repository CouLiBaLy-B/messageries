# GCP DR — Multi-région

> Phase 7 portée sur GCP. Cohabite avec `docs/PHASE7.md` (AWS).

## 🎯 Stratégie : Active-Passive

| Région | Rôle | RPO | RTO |
|---|---|---|---|
| `europe-west1` (Belgique) | **Primary** : 100% trafic | — | — |
| `europe-west4` (Pays-Bas) | **DR passive** | ≤ 60 min (transfer job GCS) / ≤ 5 min (Cloud SQL replica) | ≤ 15 min |

## 🆚 Différences vs AWS Phase 7

| Sujet | AWS | GCP |
|---|---|---|
| RDS cross-region | `replicate_source_db = arn` | `master_instance_name = "project:region:instance"` |
| Promote replica | `aws rds promote-read-replica` | `gcloud sql instances promote-replica` — **irréversible** |
| S3 CRR temps réel | Replication Time Control (15 min SLA) | Storage Transfer Service (min 60 min) OU bucket dual-region natif (~ 15 min RPO) |
| DNS failover auto | Route 53 health check + record SECONDARY | Cloud DNS WRR + Cloud Monitoring uptime check + script de bascule |
| Coût additionnel DR | ~150-200 $/mois | ~120-180 $/mois |

⚠️ **Limites Cloud SQL** :
- La promote est **destructive du lien primary→replica**. Après promote, plus de replica → recréer manuellement.
- Cloud SQL n'a pas d'équivalent direct au "promote-then-reattach" RDS.
- Pour un vrai RTO court avec PITR, considérer **Cloud Spanner** ou **AlloyDB** (HA inter-régions natif).

## 🏗️ Architecture

```
                  Cloud DNS (api.example.com)
                      │
                  routing_policy WRR
                  ├─ weight=100 → primary_lb_ip
                  └─ weight=0   → dr_lb_ip
                      │
                      │   ↑ script bascule (dr-failover.sh)
                      │   ↑ alerte (uptime check fail)

europe-west1 (Primary)              europe-west4 (DR)
┌──────────────────────┐            ┌──────────────────────┐
│ VPC + Cloud Run +    │            │ VPC DR + Cloud Run   │
│ Cloud SQL HA + Redis │            │ (desired_count low,  │
│ + GCS attachments    │            │  prêt à scale)       │
└──────────┬───────────┘            │                      │
           │                        │ Cloud SQL replica    │
           │   Cloud SQL native     │ cross-region         │
           ├──── replication ──────▶│   (PROMOTE on DR)    │
           │   (async, ~30s lag)    │                      │
           │                        │ GCS DR bucket        │
           │   Storage Transfer     │ (NEARLINE, KMS DR)   │
           └──── job 60min ────────▶│                      │
                                    └──────────────────────┘
```

## 🆕 Modules & stacks

### Modules réutilisables (DR-specific)

| Module | Rôle |
|---|---|
| `dr-cloudsql-replica/` | Read replica cross-region + CMEK régionale |
| `dr-gcs-replication/` | Bucket destination + Storage Transfer Service récurrent |
| `dr-dns-failover/` | Cloud DNS WRR + Cloud Monitoring uptime check + alert |

### Stacks d'environnement

| Stack | Rôle | Région |
|---|---|---|
| `envs/prod` | App primary (active 100%) | europe-west1 |
| `envs/dr` | Réplication données + DNS (utilise modules dr-*) | europe-west1 + europe-west4 |
| `envs/prod-dr` | **App DR passive** : Cloud Run + LB + Cloud Armor + Redis DR (min_instances=0) | europe-west4 |

⚠️ **Ordre de déploiement** :
1. `envs/prod` (primary actif)
2. `envs/dr` (replica + replication, fournit `dr_cloudsql_private_ip`, `dr_gcs_bucket_name`, VPC DR…)
3. `envs/prod-dr` (consomme les sorties de `envs/dr` via tfvars)
4. **Re-apply `envs/dr`** avec `dr_lb_ip` = sortie de `envs/prod-dr` → active le DNS failover record

## 🚀 Déploiement DR (procédure complète)

### Étape 1 — Pré-requis

- `envs/prod` déjà déployée et stable
- Avoir activé les APIs dans la même project : `compute, run, sql, redis, secretmanager, cloudkms, vpcaccess, monitoring, dns, storagetransfer`
- Le password de la DB primary (récupérable via `gcloud secrets versions access latest --secret=messaging-prod-db-password`)

### Étape 2 — Déployer envs/dr (replica + replication + placeholder DNS)

```bash
cd infra/terraform-gcp/envs/dr
cp terraform.tfvars.example terraform.tfvars
# Editer : project_id, primary_*, dns_managed_zone_name, domain_api
# IMPORTANT : laisser dr_lb_ip = "0.0.0.0" pour ce premier apply
terraform init && terraform apply
```

Récupérer les sorties :
```bash
terraform output -json > /tmp/dr-outputs.json
```

### Étape 3 — Copier l'image primary vers le registry DR

```bash
# Crée d'abord le registry DR avec terraform apply de envs/prod-dr (partial)
# Puis copie l'image actuelle :
./infra/terraform-gcp/scripts/copy-image-to-dr.sh prod api $(git rev-parse --short HEAD)
```

### Étape 4 — Déployer envs/prod-dr (app passive)

```bash
cd infra/terraform-gcp/envs/prod-dr
cp terraform.tfvars.example terraform.tfvars
# Editer en utilisant les sorties de envs/dr/outputs :
#   dr_vpc_self_link, dr_subnet_self_link, dr_vpc_connector_id,
#   dr_cloudsql_private_ip, dr_gcs_bucket_name, dr_app_kms_key_id
# + primary_db_password_value (depuis Secret Manager primary)
terraform init && terraform apply
```

Récupérer le LB DR IP :
```bash
DR_LB_IP=$(terraform output -raw dr_lb_ip)
echo "DR LB IP: $DR_LB_IP"
```

### Étape 5 — Re-apply envs/dr avec dr_lb_ip pour activer DNS failover

```bash
cd ../dr
# Editer terraform.tfvars : dr_lb_ip = "<valeur de l'étape 4>"
terraform apply
```

DNS failover armé : WRR 100/0, prêt à basculer en cas d'incident.

### Étape 6 — CI/CD continu

- Workflow `deploy-gcp-staging.yml` deploy chaque push sur le service api primary
- Workflow `deploy-gcp-prod-dr.yml` build l'image et update le service DR `--no-traffic` → la prochaine activation (failover) sert la même version applicative que primary

## 🔥 Procédure failover

### Auto (alerte uniquement)
L'uptime check primaire fail → Cloud Monitoring envoie une notif (email, PagerDuty, Slack via webhook). **PAS de bascule auto** (volontaire — un humain valide).

### Manuel
```bash
export GCP_PROJECT_ID=messaging-prod-prj
export DR_REGION=europe-west4
export DR_DB_INSTANCE=messaging-prod-dr-pg
export DR_API_SERVICE=messaging-prod-dr-api
export DNS_ZONE=example-com
export DOMAIN=api.example.com
export PRIMARY_IP=34.111.222.333
export DR_IP=34.444.555.666
export DR_MIN_INSTANCES=3

./infra/terraform-gcp/scripts/dr-failover.sh
```

Le script effectue automatiquement :
1. `gcloud sql instances promote-replica` + wait RUNNABLE/standalone (~ 3 min)
2. Récupération de la new private IP DB
3. `gcloud run services update` : `OUTBOX_WORKER_ENABLED=true` + `DB_HOST=<new>` + `--min-instances=3`
4. `gcloud dns record-sets update` WRR 0/100 (TTL DNS 60s)
5. Affichage des vérifications post-failover

### Post-failover

- L'ancien primary est inutilisable → le supprimer
- Re-créer un nouveau replica depuis la new primary (recréer le bloc `module "sql_dr"` avec `master_instance_name` inversé)
- Drill DR recommandé tous les 6 mois en heures creuses

## 🧪 Test DR drill

```bash
# Forcer un fail du primary (sans casser la prod) :
# 1. Réduire min_instances Cloud Run primary à 0
# 2. Observer alert + uptime check
# 3. Restore : remettre min_instances à 1
```

## 💸 Coût additionnel DR

| | $/mois ~ |
|---|---|
| Cloud SQL replica `db-custom-1-3840` | 35 |
| GCS DR bucket (NEARLINE) + transfer job | 10-30 |
| Cloud Run DR (min=0, prêt à scale) | 0-10 |
| VPC DR + Cloud NAT | 8 |
| Uptime checks + alerts | 5 |
| **Total** | **~60-90 $/mois** |

Le coût plus bas que AWS Phase 7 est dû à :
- GCS Storage Transfer Service vs S3 CRR Replication Time Control
- Cloud Run scale-to-zero (vs ALB DR toujours up sur AWS)
