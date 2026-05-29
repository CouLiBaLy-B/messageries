# Infrastructure GCP (Terraform)

Port complet de l'infra AWS vers Google Cloud Platform.
Coexiste avec `infra/terraform/` (AWS) — choisir l'un OU l'autre, pas les deux.

## 🎯 Mapping AWS → GCP

| AWS | GCP |
|---|---|
| VPC + subnets | VPC custom + subnets régionaux |
| KMS CMK + rotation | Cloud KMS Keyring + Crypto Keys (rotation auto) |
| Secrets Manager | Secret Manager |
| S3 bucket | Cloud Storage bucket |
| ECR | Artifact Registry (Docker repo) |
| ECS Fargate + ALB | **Cloud Run** (serverless) + Cloud Load Balancing externe |
| RDS Multi-AZ | Cloud SQL HA (regional) |
| ElastiCache Redis TLS | Memorystore Redis (TLS + AUTH) |
| AWS WAF | Cloud Armor (Adaptive Protection + Preconfigured WAF) |
| CloudWatch Logs/Metrics | Cloud Logging + Cloud Monitoring |
| IAM + OIDC GitHub | Service accounts + Workload Identity Federation |
| ALB sticky WS | Cloud Run supporte WebSocket nativement |
| NATS Fargate | NATS GKE Autopilot (StatefulSet + PD) |
| OpenSearch | Elastic Cloud on GCP (managé) OU GKE self-host |
| X-Ray + ADOT sidecar | Cloud Trace + OTel collector (sidecar Cloud Run) |

## 📁 Structure

```
infra/terraform-gcp/
├── versions.tf
├── modules/
│   ├── network/         # VPC + subnets + Cloud NAT
│   ├── kms/             # KeyRing + 4 CryptoKeys (db, gcs, app, logs)
│   ├── secrets/         # Secrets (jwt, db, redis_auth)
│   ├── gcs/             # Bucket attachments (CMEK + uniform access + lifecycle)
│   ├── artifact-registry/  # Docker repo
│   ├── cloudsql/        # Postgres HA + private IP
│   ├── memorystore/     # Redis HA + TLS + AUTH
│   ├── cloudrun/        # Service api + ws-gateway (HTTPS, autoscale)
│   ├── loadbalancer/    # HTTPS LB + Cloud Armor + cert managé
│   ├── cloudarmor/      # WAF policy
│   ├── observability/   # Alerting + dashboards
│   ├── iam/             # SA + Workload Identity Fed pour GitHub OIDC
│   ├── nats/            # NATS sur GKE Autopilot (opt-in)
│   └── opensearch/      # stub doc (Elastic Cloud externe)
├── envs/
│   ├── staging/
│   └── prod/
└── scripts/
    ├── bootstrap-state.sh
    ├── push-image.sh
    └── run-migrations.sh
```

## 🚀 Bootstrap

```bash
# 1. Créer un projet GCP
gcloud projects create messaging-staging-prj
gcloud config set project messaging-staging-prj
gcloud services enable compute.googleapis.com servicenetworking.googleapis.com \
  cloudkms.googleapis.com secretmanager.googleapis.com sqladmin.googleapis.com \
  redis.googleapis.com run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com vpcaccess.googleapis.com \
  cloudtrace.googleapis.com logging.googleapis.com monitoring.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com

# 2. State backend (GCS)
./infra/terraform-gcp/scripts/bootstrap-state.sh staging europe-west1

# 3. Apply
cd infra/terraform-gcp/envs/staging
terraform init
terraform apply -var='project_id=messaging-staging-prj' -var='domain_name=...'
```

## 💸 Coût estimé staging (europe-west1)

| | $/mois ~ |
|---|---|
| Cloud SQL db-custom-1-3840 HA | 75 |
| Memorystore standard 1 GB | 50 |
| Cloud Run 2× minInstances (0.5 vCPU) | 20 |
| LB + Cloud Armor | 20 |
| GCS + KMS + logs | 10 |
| **Total staging** | **~175** |

Prod : Cloud SQL HA `db-custom-2-7680` + Memorystore 5 GB + 3+ Cloud Run instances : ~500-700 $/mois.

## 🔐 Sécurité

- VPC privé + Cloud NAT (pas d'IPs publiques sur Cloud SQL/Memorystore)
- CMEK KMS sur Cloud SQL + GCS + Memorystore
- Cloud Armor : preconfigured WAF (OWASP CRS) + rate limit
- Workload Identity Federation GitHub → SA (pas de credentials longue durée)
- VPC Service Controls recommandé en prod (hors module, niveau org)
- Audit Logs (Data Access) à activer au niveau org/project (Logging)

## 🆚 Pourquoi Cloud Run plutôt que GKE ?

- Pas d'admin cluster, scaling à zéro possible, billing per-request
- Supporte WebSocket natif (HTTP/2 streaming) → pas besoin de NLB séparé
- HTTPS managé out-of-the-box + Cloud LB devant pour Cloud Armor
- GKE garde sa valeur pour NATS (workload stateful avec PD)
