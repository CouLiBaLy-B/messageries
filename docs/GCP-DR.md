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

## 🆕 Modules

| Module | Rôle |
|---|---|
| `dr-cloudsql-replica/` | Read replica cross-region + CMEK régionale |
| `dr-gcs-replication/` | Bucket destination + Storage Transfer Service récurrent |
| `dr-dns-failover/` | Cloud DNS WRR + Cloud Monitoring uptime check + alert |

## 🚀 Déploiement DR

```bash
# 1. La stack primary (envs/prod) doit être en place ET stable

# 2. Déployer la stack Cloud Run/LB dans la région DR
#    (dupliquer envs/prod en envs/prod-dr avec dr_region)
#    → on récupère dr_lb_ip

# 3. Stack DR (replica + replication + DNS)
cd infra/terraform-gcp/envs/dr
cp terraform.tfvars.example terraform.tfvars
# Éditer terraform.tfvars (cf. outputs envs/prod)
terraform init
terraform apply
```

## 🔥 Procédure failover

### Auto (alerte uniquement)
L'uptime check primaire fail → Cloud Monitoring envoie une notif (email, PagerDuty, Slack via webhook). **PAS de bascule auto** (volontaire — un humain valide).

### Manuel
```bash
export GCP_PROJECT_ID=messaging-prod-prj
export DR_REGION=europe-west4
export DR_DB_INSTANCE=messaging-prod-dr-pg
export DNS_ZONE=example-com
export DOMAIN=api.example.com
export PRIMARY_IP=34.111.222.333
export DR_IP=34.444.555.666

./infra/terraform-gcp/scripts/dr-failover.sh
```

Effectue :
1. `gcloud sql instances promote-replica` (~ 3 min)
2. Attente état RUNNABLE + role standalone
3. `gcloud dns record-sets update` WRR 0/100 (TTL DNS 60s → ~ 1 min)
4. **Manuel** : update `DB_HOST` Cloud Run, scale up DR services

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
