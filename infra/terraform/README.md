# Infrastructure Terraform — Messagerie E-commerce

Déploiement complet AWS avec :

- **VPC** 3 AZ, subnets publics + privés + database isolés
- **RDS PostgreSQL 16** Multi-AZ, chiffré KMS, backups 14j
- **ElastiCache Redis 7** cluster mode, TLS, AUTH token
- **S3** bucket privé pour attachments, chiffrement KMS, bucket policy `aws:SecureTransport=true`
- **KMS** : 3 clés CMK (RDS, S3, App envelope)
- **ECR** repository pour l'image backend
- **ECS Fargate** + Application Load Balancer (HTTPS + WebSocket sticky)
- **AWS WAF** v2 avec règles managées OWASP CRS + RateBasedRule
- **Secrets Manager** : JWT_SECRET, DB password, Redis AUTH
- **CloudWatch** : log groups, alarmes (5xx, latence, CPU, DB connections, outbox lag), dashboard
- **IAM** : rôles least-privilege (task role + execution role)

## 📁 Structure

```
infra/terraform/
├── versions.tf
├── envs/
│   ├── staging/
│   │   ├── main.tf          # compose les modules
│   │   ├── variables.tf
│   │   ├── terraform.tfvars  # valeurs staging
│   │   └── backend.tf        # remote state S3 + DynamoDB lock
│   └── prod/
│       └── (idem, valeurs prod)
└── modules/
    ├── vpc/
    ├── kms/
    ├── secrets/
    ├── rds/
    ├── redis/
    ├── s3/
    ├── ecr/
    ├── alb/
    ├── waf/
    ├── ecs/
    ├── iam/
    └── observability/
```

## 🚀 Bootstrap initial (state S3 + lock DynamoDB)

```bash
cd infra/scripts
./bootstrap-state.sh staging eu-west-3
./bootstrap-state.sh prod eu-west-3
```

Cela crée :
- bucket S3 `messaging-tfstate-<account>-<env>` (versionné, chiffré, public access bloqué)
- table DynamoDB `messaging-tflock-<env>`

## ⚙️ Déploiement

```bash
cd infra/terraform/envs/staging
terraform init
terraform plan  -out=plan.tfplan
terraform apply plan.tfplan
```

Outputs utiles :
- `alb_dns_name` → CNAME à pointer dans Route53
- `ecr_repository_url` → pour push image
- `cloudwatch_log_group` → tail logs

## 🐳 Build & push image

```bash
make push-image ENV=staging
# (cf. infra/scripts/push-image.sh)
```

## 🔁 Rolling update

```bash
aws ecs update-service \
  --cluster messaging-staging \
  --service messaging-staging-api \
  --force-new-deployment
```

GitHub Actions le fait automatiquement à chaque push sur `main`.

## 💰 Coût estimé staging (eu-west-3, 2026)

| Composant | Spec | $/mois ~ |
|---|---|---|
| RDS db.t4g.small Multi-AZ | 2 vCPU, 2 GB | 65 |
| ElastiCache cache.t4g.small | 2 nodes | 45 |
| ECS Fargate 2× (0.5 vCPU, 1 GB) | 24/7 | 25 |
| ALB | 1 | 22 |
| NAT Gateway × 2 | | 70 |
| S3 + KMS + logs | léger | 10 |
| **Total staging** | | **~240** |

Prod multi-AZ + 3 tasks + RDS m6g.large : ~600-800 $/mois.

## 🛡️ Notes sécurité

- DB et Redis dans subnets privés, **jamais** d'IP publique
- Tous les SGs filtrent en entrée par SG source (pas de `0.0.0.0/0` sauf ALB:443)
- WAF règles AWS managed : `AWSManagedRulesCommonRuleSet`, `AWSManagedRulesKnownBadInputsRuleSet`, `AWSManagedRulesSQLiRuleSet`
- TLS 1.2+ uniquement sur ALB (security policy)
- Secrets Manager → injection via ECS task definition (jamais en clair)
- CloudTrail à activer au niveau compte (hors de ce repo)
- GuardDuty + Security Hub recommandés (hors de ce repo, multi-compte)
