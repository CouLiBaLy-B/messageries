# Phase 3 — Déploiement Production AWS

Infrastructure complète **Terraform** + **observabilité** pour deployer la messagerie sur AWS.

## 🏗️ Architecture déployée

```
                      Internet
                          │
                          ▼
                   ┌──────────────┐
                   │  Route 53    │ (hors Terraform : CNAME → ALB)
                   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────┐
                   │   AWS WAF    │  CRS + RateLimit 2k/5min/IP
                   └──────┬───────┘
                          │
                          ▼
              ┌────────────────────────┐
              │ Application LB (HTTPS) │  TLS 1.2+, WebSocket sticky
              │  + drop_invalid_header │
              └────────┬───────────────┘
                       │
                       ▼  (target type: ip)
   ┌──────────────────────────────────────────────┐
   │  VPC 10.20.0.0/16 (3 AZ)                     │
   │                                              │
   │   Public subnets : ALB, NAT GW               │
   │                                              │
   │   App subnets (privés) :                     │
   │   ┌──────────────────────────────────────┐   │
   │   │ ECS Fargate (ARM64)                  │   │
   │   │  • 2..10 tasks (autoscale)           │   │
   │   │  • image ECR via OIDC GitHub         │   │
   │   │  • IAM task role → S3, KMS, CW       │   │
   │   │  • secrets from Secrets Manager      │   │
   │   └──────────────────────────────────────┘   │
   │                                              │
   │   Data subnets (privés, no Internet) :       │
   │   ┌──────────────────────────────────────┐   │
   │   │ RDS Postgres Multi-AZ (KMS)          │   │
   │   │ ElastiCache Redis (TLS+AUTH+MultiAZ) │   │
   │   └──────────────────────────────────────┘   │
   └──────────────────────────────────────────────┘
                       │
                       ▼
              ┌────────────────────────┐
              │ S3 attachments (KMS)   │  bucket policy strict TLS
              │ Lifecycle 90j→Glacier  │
              └────────────────────────┘

  CloudWatch logs/metrics/alarms ──▶ SNS ──▶ Email/PagerDuty
  KMS (rds, s3, app envelope, logs)
```

## 📦 Modules Terraform

| Module | Rôle |
|---|---|
| `vpc/` | 3 AZ, public/app/data subnets, Flow Logs (REJECT) |
| `kms/` | 4 CMK séparées (rds, s3, app, logs) + rotation auto |
| `secrets/` | JWT, DB pwd, Redis auth (random) |
| `s3/` | Bucket attachments KMS + policy strict + lifecycle |
| `ecr/` | Repo immuable + scan on push |
| `rds/` | Postgres 16 Multi-AZ + PG params hardened + Performance Insights |
| `redis/` | ElastiCache 7 cluster + TLS + AUTH + slowlog CW |
| `alb/` | ALB + HTTPS + sticky 8h + redirect 80→443 |
| `waf/` | AWS Managed Rules + RateBasedRule |
| `iam/` | exec/task roles + GitHub OIDC deploy role |
| `ecs/` | Fargate cluster + service + task def + autoscale CPU/req |
| `observability/` | SNS + alarmes ALB/ECS/RDS + custom + dashboard |

## 🚀 Premier déploiement

### 1. Pré-requis AWS

- Compte AWS avec admin temporaire
- Domaine + certificat ACM dans la **même région** que l'ALB
- (Optionnel) GitHub OIDC IdP créé une fois pour tout le compte :

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 2. Bootstrap du state

```bash
cd infra/scripts
./bootstrap-state.sh staging eu-west-3
# affichage : bucket = messaging-tfstate-XXXX-staging
```

Mettre à jour `envs/staging/backend.tf` avec ce bucket.

### 3. Configuration

Éditer `envs/staging/terraform.tfvars` :

```hcl
domain_name     = "staging.api.example.com"
certificate_arn = "arn:aws:acm:eu-west-3:XXX:certificate/YYY"
alert_emails    = ["ops@example.com"]
allowed_origins = ["https://staging.app.example.com"]
github_repo     = "yourorg/messagerie"
```

### 4. Apply

```bash
cd envs/staging
terraform init
terraform plan -out=plan.tfplan
terraform apply plan.tfplan
```

Outputs notables :
- `alb_dns_name` → CNAME Route53
- `ecr_repository_url` → pour le push image
- `github_deploy_role_arn` → secret GitHub `AWS_DEPLOY_ROLE_ARN_STAGING`

### 5. Build & push image

```bash
cd infra/scripts
./push-image.sh staging v0.3.0
```

### 6. Migrations DB

```bash
./run-migrations.sh staging
```

### 7. Force redeploy

```bash
aws ecs update-service \
  --cluster messaging-staging \
  --service messaging-staging-api \
  --force-new-deployment \
  --region eu-west-3
```

### 8. Vérification

```bash
# health
curl https://staging.api.example.com/api/v1/health

# WS via wscat
wscat -c wss://staging.api.example.com/ws \
  -H "Origin: https://staging.app.example.com"
```

## 🔁 Déploiement continu (GitHub Actions)

1. Créer le secret GitHub `AWS_DEPLOY_ROLE_ARN_STAGING` avec la valeur de `github_deploy_role_arn`.
2. Push sur `main` → `.github/workflows/deploy-staging.yml` :
   - build image ARM64 → ECR
   - migrations (ECS one-shot task)
   - rolling deploy (`update-service --force-new-deployment`)
   - wait for stable

## 📊 Observabilité

### Métriques applicatives publiées (CloudWatch namespace `Messaging`)
| Métrique | Type | Source |
|---|---|---|
| `MessagesSent` | Count | `MessagesService.send` |
| `MessageSendDurationMs` | Milliseconds | idem |
| `MessagesEncrypted` / `MessagesPlaintext` | Count | idem |
| `ModerationFlagged` | Count | scan PAN/IBAN/... |
| `ModerationFlagByType{flag=pan|iban|...}` | Count | idem |
| `OutboxProcessed` | Count | outbox worker |
| `OutboxLagSeconds` | Seconds (gauge, 30s) | outbox worker |
| `OutboxFailure{event_type}` | Count | outbox retry |
| `RefreshTokenRotated` | Count | auth |
| `RefreshTokenReplayDetected` | Count | 🚨 alerte sécurité |

### Alarmes
- `alb-5xx` > 10 / min × 2 → SNS
- `alb-latency-p95` > 1.5s × 3 min → SNS
- `ecs-cpu-high` > 85% × 3 min → SNS
- `rds-cpu-high` > 80% × 5 min → SNS
- `rds-connections-high` > seuil
- `rds-free-storage-low` < 5 GB
- `outbox-lag-high` > 60s × 3 min
- **`security-refresh-replay` ≥ 1** → SNS immédiat (compromission session)

### Dashboard
`messaging-<env>-dashboard` : ALB req+5xx, latence p50/95/99, ECS, RDS, Outbox, sécurité.

## 🛡️ Sécurité — checklist déploiement

- [x] TLS 1.2+ ALB (policy `ELBSecurityPolicy-TLS13-1-2-2021-06`)
- [x] HSTS prod (helmet)
- [x] WAF managed rules (Common, SQLi, BadInputs, IpRep) + rate limit
- [x] SG ECS → RDS/Redis : ingress par SG source uniquement
- [x] RDS/Redis dans subnets privés data (no route Internet)
- [x] S3 : public access bloqué + deny non-TLS + deny non-KMS
- [x] KMS séparées (rotation auto activée)
- [x] Secrets Manager → ECS `valueFrom` (jamais en clair)
- [x] ECR scan on push + tags immuables
- [x] CloudWatch logs chiffrés KMS
- [x] VPC Flow Logs (REJECT) → audit réseau
- [x] GitHub OIDC (pas de credentials longue durée)
- [x] ECS execute-command activé pour debug (audit via CloudTrail)
- [x] Alarme refresh replay = signal incident

À ajouter au niveau compte (hors Terraform multi-comptes) :
- CloudTrail multi-région
- GuardDuty
- Security Hub + standards CIS/AWS Foundational
- AWS Config

## 💰 Coût estimé

| Env | Composants | $/mois ~ |
|---|---|---|
| **staging** | t4g.small × Multi-AZ × 1 NAT × 2 Fargate | **240 $** |
| **prod** | m6g.large × Multi-AZ × 3 NAT × 3-20 Fargate × Multi-AZ Redis | **700–900 $** |

Lever régulièrement (cost explorer) et utiliser FARGATE_SPOT pour les workloads tolérants.

## 🐛 Runbook incidents

### Service `Unhealthy`
```bash
aws ecs describe-services --cluster messaging-prod --services messaging-prod-api
# Voir events → erreurs déploiement
aws logs tail /ecs/messaging-prod --since 10m --follow
```

### DB connections plafond
- Vérifier `DB_POOL_MAX` task env (10 par défaut)
- Multiplier par `desired_count` → doit rester < `max_connections` RDS

### Outbox lag élevé
- Logs : `outbox loop error` ?
- DB lock contention : `SELECT * FROM pg_locks WHERE granted=false`
- Scale ECS si nécessaire

### Alerte `RefreshTokenReplayDetected`
1. Identifier le user via logs (`Refresh token replay detected user=...`)
2. Vérifier audit_log → IP, UserAgent, géoloc
3. Si confirmé compromission → suspend user, contact, forensics

### Rollback déploiement
ECS Deployment Circuit Breaker rollback automatiquement si > 50% des tasks échouent. Manuellement :
```bash
aws ecs update-service \
  --cluster messaging-prod --service messaging-prod-api \
  --task-definition messaging-prod-api:<previous_revision>
```
