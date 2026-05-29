# GCP Deployment

Cette branche `feat/gcp-infra` ajoute le support GCP **en parallèle** d'AWS — pas en remplacement. Le code détecte automatiquement le cloud via variables d'environnement.

## 🧭 Comment ça marche

Le backend a 3 abstractions multi-cloud :

| | Variable | Valeurs | Effet |
|---|---|---|---|
| **Storage** | `STORAGE_DRIVER` | `s3` (def) \| `gcs` | S3Service ou GcsStorageService injecté via DI |
| **KMS** | `KMS_DRIVER` | `local` (def) \| `aws` \| `gcp` | LocalKmsProvider / AwsKmsProvider / GcpKmsProvider |
| **Metrics** | `METRICS_DRIVER` | `cloudwatch` (def) \| `gcp` | CloudWatch ou Cloud Monitoring TimeSeries |

Aucun comportement par défaut n'est changé → toutes les phases AWS antérieures continuent de fonctionner sans modif.

## 📁 Structure GCP

```
infra/terraform-gcp/
├── modules/
│   ├── network/             # VPC + PSA + Cloud NAT + VPC Connector
│   ├── kms/                 # KeyRing + 4 CryptoKeys (db, gcs, app, logs)
│   ├── secrets/             # Secret Manager (JWT, DB, Redis AUTH) + CMEK
│   ├── gcs/                 # Bucket attachments (CMEK, uniform access, lifecycle)
│   ├── artifact-registry/   # Docker repo
│   ├── cloudsql/            # Postgres 16 HA + private IP + CMEK
│   ├── memorystore/         # Redis 7 STANDARD_HA + TLS + AUTH + CMEK
│   ├── cloudrun/            # Service générique (api / ws-gateway)
│   ├── loadbalancer/        # HTTPS LB + cert managé + cloud armor
│   ├── cloudarmor/          # WAF OWASP CRS + rate limit
│   ├── iam/                 # SAs + Workload Identity Federation GitHub
│   ├── nats/                # GKE Autopilot (opt-in)
│   ├── opensearch/          # placeholder Elastic Cloud / GKE
│   └── observability/       # Cloud Monitoring alerts
├── envs/
│   ├── staging/
│   └── prod/
└── scripts/
    ├── bootstrap-state.sh
    ├── push-image.sh
    └── run-migrations.sh
```

## 🚀 Bootstrap initial

```bash
# 1. Créer projet + activer APIs
gcloud projects create messaging-staging-prj
gcloud config set project messaging-staging-prj
gcloud services enable compute.googleapis.com servicenetworking.googleapis.com \
  cloudkms.googleapis.com secretmanager.googleapis.com sqladmin.googleapis.com \
  redis.googleapis.com run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com vpcaccess.googleapis.com \
  cloudtrace.googleapis.com logging.googleapis.com monitoring.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com container.googleapis.com

# 2. State bucket
./infra/terraform-gcp/scripts/bootstrap-state.sh staging europe-west1

# 3. Renseigner les valeurs
cd infra/terraform-gcp/envs/staging
cp terraform.tfvars.example terraform.tfvars
# Éditer terraform.tfvars (project_id, domain_api, github_repo, ...)

# 4. Init + apply
terraform init
terraform apply
```

Outputs notables :
- `lb_ip` → DNS A record vers `staging.api.example.com`
- `artifact_registry_url` → pour push image
- `workload_identity_provider` + `deploy_sa_email` → secrets GitHub Actions

## 🐳 Build & push

```bash
./infra/terraform-gcp/scripts/push-image.sh staging api v0.9.0
gcloud run deploy messaging-staging-api \
  --image europe-west1-docker.pkg.dev/.../api:v0.9.0 \
  --region europe-west1
```

## 🔁 Migrations

```bash
./infra/terraform-gcp/scripts/run-migrations.sh staging
```

(Crée un Cloud Run **Job** one-shot avec la même image, override la command pour `npm run migration:run`.)

## 🔐 Sécurité

| Contrôle | Mécanisme GCP |
|---|---|
| Pas d'IP publique DB/Redis | Cloud SQL/Memorystore en `PRIVATE_SERVICE_ACCESS` via PSA |
| Chiffrement CMEK | KMS CryptoKey appliquée à GCS, Cloud SQL, Memorystore, Secret Manager |
| TLS imposé | Cloud SQL `ssl_mode = ENCRYPTED_ONLY` ; Memorystore `SERVER_AUTHENTICATION` ; LB SSL policy `MODERN` (TLS 1.2+) |
| WAF | Cloud Armor preconfigured rules (sqli, xss, lfi, rfi, protocolattack) + rate limit IP |
| Secrets | Secret Manager + IAM granulaire (un secret = un membre SA) |
| Anti-DDoS | Cloud Armor Adaptive Protection L7 |
| OIDC GitHub | Workload Identity Federation : pas de service account key longue durée |
| Audit | Cloud Audit Logs (Data Access) à activer au niveau projet |
| Bucket Storage | `uniform_bucket_level_access` + `public_access_prevention=enforced` + versioning + soft delete 7j |

## 💸 Coût staging europe-west1

| | $/mois ~ |
|---|---|
| Cloud SQL `db-custom-1-3840` HA | 75 |
| Memorystore `STANDARD_HA` 1 GB | 50 |
| Cloud Run `min=1, max=10` (peu de trafic) | 15 |
| LB + Cloud Armor | 22 |
| GCS + KMS + logs | 10 |
| VPC connector + Cloud NAT | 8 |
| **Total** | **~180** |

Prod : `db-custom-2-7680` + Redis 5GB + 3+ Cloud Run instances + GKE Autopilot NATS : ~500-700 $/mois.

## 🆚 GCP vs AWS — différences clés

| Sujet | AWS (Phases 1-8) | GCP (cette branche) |
|---|---|---|
| Compute | ECS Fargate ARM64 + ALB | Cloud Run amd64 + LB + serverless NEG |
| WebSocket | NLB dédié (Phase 5) | Cloud Run supporte natif (concurrency=200, timeout=3600) |
| KMS GenerateDataKey | API native | Encrypt(randomBytes) — pas d'API GenerateDataKey, on génère localement |
| Secrets | Secrets Manager + IAM par ARN | Secret Manager + IAM granulaire par secret |
| DR cross-region | RDS replica + S3 CRR + Route 53 | Cloud SQL cross-region replica + GCS dual-region + Cloud DNS failover |
| OIDC CI | OIDC IdP + role AssumeRoleWithWebIdentity | Workload Identity Federation + SA impersonation |
| OpenSearch | AWS OpenSearch managed | Elastic Cloud on GCP (partenaire) ou GKE self-host |

## 🧪 Tests

Les tests existants utilisent MinIO (S3) → continuent à passer. Pour tester le driver GCS en CI :

```bash
# fake-gcs-server (équivalent MinIO pour GCS)
docker run -p 4443:4443 fsouza/fake-gcs-server -scheme http
STORAGE_DRIVER=gcs GCS_BUCKET=test ... npm run test:e2e
```

(Implémenter un test e2e dédié laissé pour PR suivante.)


## 🌍 Disaster Recovery multi-région

Voir [`docs/GCP-DR.md`](GCP-DR.md) pour la procédure DR cross-region (Cloud SQL replica + GCS replication + Cloud DNS failover).

## 🚧 Limitations connues

- Module `nats/` provisionne le cluster GKE ; le déploiement Helm de NATS reste manuel (cf. `modules/nats/install.md`)
- Module `opensearch/` est un placeholder — Elastic Cloud doit être souscrit côté Elastic
- Pas d'équivalent direct du Phase 7 DR (RPO 5min) en GCP dans cette première PR — Cloud SQL cross-region replication à scripter dans une PR séparée
