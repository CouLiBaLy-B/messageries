# Phase 7 — Multi-région DR

## 🎯 Stratégie : Active-Passive avec Route 53 failover

| Région | Rôle | Coût | Latence |
|---|---|---|---|
| `eu-west-3` (Paris) | **Primary** : 100% trafic | full | < 30ms FR |
| `eu-west-1` (Dublin) | **Passive** : standby, données synchronisées | ~30% | failover only |

## 📊 RPO / RTO

| | Cible | Mécanisme |
|---|---|---|
| **RPO** | ≤ 5 min | RDS cross-region async replication (~30s lag typique) + S3 CRR RTC 15min |
| **RTO** | ≤ 15 min | Route 53 health check (90s) + promote replica (~3min) + ECS scale-up (~5min) |

## 🏗️ Architecture

```
                 Route 53 zone (api.example.com)
                  ├─ failover record PRIMARY → ALB eu-west-3
                  │   (health check /api/v1/health × 3 régions)
                  └─ failover record SECONDARY → ALB eu-west-1

eu-west-3 (Primary)              eu-west-1 (DR)
┌──────────────────┐             ┌──────────────────┐
│ VPC + ALB + ECS  │             │ VPC + ALB + ECS  │
│                  │             │  (desired=0,     │
│ RDS Multi-AZ ────┼──CRR──────▶ │   prêt à scale)  │
│                  │   async     │                  │
│ S3 + KMS         │             │ RDS read replica │
│         │        │             │  (KMS DR)        │
│         └────────┼──CRR RTC───▶│ S3 dest + KMS DR │
│                  │             │                  │
│ Redis (state lost│             │ (state DR : ré-  │
│   en failover OK)│             │  initialisé)     │
└──────────────────┘             └──────────────────┘
```

## 🆕 Modules Terraform

| Module | Rôle |
|---|---|
| `dr-rds-replica/` | RDS cross-region read replica (KMS DR séparée) |
| `dr-s3-replication/` | Bucket destination DR + IAM réplication + KMS swap + RTC 15min |
| `dr-route53-failover/` | Records A failover PRIMARY/SECONDARY + health check multi-région + alarme SNS |

## 🚀 Déploiement

```bash
# 1. Stack primary déjà en place (envs/prod)

# 2. Stack DR (région différente du backend Terraform = OK car state séparé)
cd infra/terraform/envs/dr
# Renseigner tfvars avec les outputs de prod :
cat > terraform.tfvars <<EOF
primary_region         = "eu-west-3"
dr_region              = "eu-west-1"
env                    = "prod"
primary_rds_arn        = "arn:aws:rds:eu-west-3:XXX:db:messaging-prod-pg"
primary_s3_bucket_name = "messaging-prod-attachments-abcd1234"
primary_s3_bucket_arn  = "arn:aws:s3:::messaging-prod-attachments-abcd1234"
primary_s3_kms_key_arn = "arn:aws:kms:eu-west-3:XXX:key/..."
primary_alb_dns        = "messaging-prod-alb-...elb.amazonaws.com"
primary_alb_zone_id    = "Z3Q77PNBQS71R4"
primary_sns_topic_arn  = "arn:aws:sns:eu-west-3:XXX:messaging-prod-alerts"
dr_alb_dns             = "messaging-prod-dr-alb-...elb.amazonaws.com"
dr_alb_zone_id         = "Z32O12XQLNTSW2"
hosted_zone_id         = "Z01234..."
domain_name            = "api.example.com"
EOF
terraform init
terraform apply
```

Pour l'ECS DR : déployer **les mêmes modules** (`./modules/ecs`, `/alb`, `/iam`) dans la région DR (composition séparée non incluse ici pour rester DRY ; voir `envs/prod` à dupliquer avec `region=eu-west-1`).

## 🔥 Procédure failover

### Auto (Route 53 health check)
Si l'ALB primaire répond 5xx ou tombe :
1. Route 53 detect (3 fails × 30s = 90s)
2. Trafic DNS → ALB DR
3. ⚠️ La DB DR est en read-only → l'API DR répond aux GET, échoue sur POST

### Manuel (promote DB)
```bash
./infra/scripts/dr-failover.sh
```
Effectue :
1. `promote-read-replica` → DB DR devient writable
2. `update-service --desired-count 3` (ECS DR scale up)
3. Route 53 a déjà basculé le trafic

**RTO mesuré** : ~ 10-15 min en pratique.

### Post-failover

- DB primary cassée → la traiter comme une perte, créer un nouveau replica depuis la nouvelle primary
- Reconfigurer la stack `envs/dr` avec inversion des rôles (primary devient l'ancien DR)
- Drill de retour-en-arrière à faire en heures creuses

## 🧪 Test DR (DR drill recommandé tous les 6 mois)

```bash
# 1. Health check primary forcé KO
aws elbv2 modify-target-group --target-group-arn ... --health-check-path /not-exists
# 2. Vérifier que Route 53 bascule (dig api.example.com)
# 3. Restaurer
```

## 🚫 Hors scope

- **Redis Multi-region** : volontairement non répliqué (sessions, présence, rate limit = état éphémère reconstructible). Au failover, tous les WS se reconnectent au DR.
- **NATS JetStream cross-region** : possible (mirror) mais lourd à opérer. En DR, perte de l'historique des events non encore consommés.
- **OpenSearch DR** : si activé, prévoir snapshot manuel ou cluster cross-region. Non inclus.

## 💸 Coût additionnel DR
- RDS replica `db.t4g.small` Multi-AZ : ~70 $/mois
- S3 bucket DR + transfert CRR : variable selon volume
- VPC DR + ALB DR (idle) : ~25 $/mois
- **Total ~150-200 $/mois** pour avoir un RTO 15min.
