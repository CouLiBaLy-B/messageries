/**
 * Composition staging GCP.
 *
 * Ordre :
 *   1. network (VPC + PSA + connector)
 *   2. KMS
 *   3. secrets
 *   4. Artifact Registry
 *   5. GCS (attachments)
 *   6. Cloud SQL + Memorystore (utilisent PSA)
 *   7. IAM (SA + WIF)
 *   8. Cloud Run (api, optionnellement ws-gateway)
 *   9. Cloud Armor
 *  10. Load Balancer HTTPS (route api.* et ws.*)
 *  11. Observability (alertes)
 */

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

locals {
  name = "messaging-${var.env}"
  common_labels = {
    project     = "messaging"
    environment = var.env
    managed_by  = "terraform"
  }
}

# --- Network ---
module "network" {
  source = "../../modules/network"
  name   = local.name
  region = var.region
}

# --- KMS ---
module "kms" {
  source = "../../modules/kms"
  name   = local.name
  region = var.region
}

# --- Secrets ---
module "secrets" {
  source     = "../../modules/secrets"
  name       = local.name
  region     = var.region
  kms_key_id = module.kms.app_key_id
}

# --- Artifact Registry ---
module "ar" {
  source = "../../modules/artifact-registry"
  name   = local.name
  region = var.region
}

# --- GCS ---
module "gcs" {
  source          = "../../modules/gcs"
  name            = local.name
  region          = var.region
  kms_key_id      = module.kms.gcs_key_id
  allowed_origins = var.allowed_origins
}

# --- Cloud SQL ---
module "sql" {
  source              = "../../modules/cloudsql"
  name                = local.name
  region              = var.region
  vpc_self_link       = module.network.vpc_self_link
  kms_key_id          = module.kms.db_key_id
  master_password     = module.secrets.db_password_value
  tier                = "db-custom-1-3840"
  ha                  = true
  deletion_protection = false # staging
  psa_dependency      = module.network.psa_connection
}

# --- Memorystore ---
module "redis" {
  source        = "../../modules/memorystore"
  name          = local.name
  region        = var.region
  vpc_self_link = module.network.vpc_self_link
  kms_key_id    = module.kms.db_key_id
  memory_gb     = 1
}

# --- IAM ---
module "iam" {
  source                = "../../modules/iam"
  name                  = local.name
  jwt_secret_id         = module.secrets.jwt_secret_id
  db_password_id        = module.secrets.db_password_id
  redis_auth_id         = module.secrets.redis_auth_id
  gcs_bucket_name       = module.gcs.bucket_name
  app_kms_key_id        = module.kms.app_key_id
  create_ws_gateway_sa  = var.enable_ws_gateway
  create_github_deploy  = var.github_repo != ""
  github_repo           = var.github_repo
}

# --- Cloud Run API ---
locals {
  api_env = {
    NODE_ENV               = var.env
    PORT                   = "3000"
    API_PREFIX             = "api/v1"
    APP_URL                = "https://${var.domain_api}"
    ALLOWED_ORIGINS        = join(",", var.allowed_origins)
    DB_HOST                = module.sql.private_ip
    DB_PORT                = "5432"
    DB_USERNAME            = module.sql.username
    DB_NAME                = module.sql.db_name
    DB_SSL                 = "true"
    REDIS_HOST             = module.redis.host
    REDIS_PORT             = tostring(module.redis.port)
    REDIS_TLS              = "true"
    # Storage abstraction : driver gcs au lieu de s3
    STORAGE_DRIVER         = "gcs"
    GCS_BUCKET             = module.gcs.bucket_name
    # KMS
    KMS_DRIVER             = "gcp"
    GCP_KMS_KEY_NAME       = module.kms.app_key_id
    ENCRYPT_MESSAGE_BODY   = "true"
    OUTBOX_WORKER_ENABLED  = "true"
    # Observability
    METRICS_ENABLED        = "true"
    METRICS_DRIVER         = "gcp"
    METRICS_NAMESPACE      = "custom.googleapis.com/messaging"
    TRACING_ENABLED        = "true"
    OTEL_SERVICE_NAME      = "${local.name}-api"
    APP_VERSION            = "0.8.0"
  }
  api_secrets = {
    JWT_SECRET = { secret_id = module.secrets.jwt_secret_id }
    DB_PASSWORD = { secret_id = module.secrets.db_password_id }
    REDIS_PASSWORD = { secret_id = module.secrets.redis_auth_id }
  }
}

module "api" {
  source                = "../../modules/cloudrun"
  name                  = "${local.name}-api"
  region                = var.region
  service_account_email = module.iam.api_sa_email
  image_uri             = var.api_image_uri
  container_port        = 3000
  health_path           = "/api/v1/health"
  cpu                   = "1"
  memory                = "1Gi"
  min_instances         = 1
  max_instances         = 10
  concurrency           = 80
  vpc_connector         = module.network.vpc_connector_id
  environment           = local.api_env
  secret_env            = local.api_secrets
}

# --- Cloud Run ws-gateway (opt-in) ---
module "ws_gateway" {
  count                 = var.enable_ws_gateway ? 1 : 0
  source                = "../../modules/cloudrun"
  name                  = "${local.name}-ws"
  region                = var.region
  service_account_email = module.iam.ws_sa_email
  image_uri             = var.ws_image_uri
  container_port        = 3001
  health_path           = "/healthz"
  cpu                   = "1"
  memory                = "1Gi"
  min_instances         = 1
  max_instances         = 10
  concurrency           = 200 # WS = beaucoup de connexions par instance
  timeout_seconds       = 3600
  vpc_connector         = module.network.vpc_connector_id
  environment = {
    PORT            = "3001"
    ALLOWED_ORIGINS = join(",", var.allowed_origins)
    REDIS_HOST      = module.redis.host
    REDIS_PORT      = tostring(module.redis.port)
    REDIS_TLS       = "true"
    NATS_URL        = "nats://nats.default.svc.cluster.local:4222"
    NATS_STREAM     = "MESSAGING_EVENTS"
    NATS_DURABLE    = "ws-gateway"
    LOG_LEVEL       = "info"
  }
  secret_env = {
    JWT_SECRET     = { secret_id = module.secrets.jwt_secret_id }
    REDIS_PASSWORD = { secret_id = module.secrets.redis_auth_id }
  }
}

# --- Cloud Armor ---
module "armor" {
  source = "../../modules/cloudarmor"
  name   = local.name
  rate_limit_per_5min = 2000
}

# --- Load Balancer HTTPS ---
module "lb" {
  source = "../../modules/loadbalancer"
  name   = local.name

  cloud_run_services = merge(
    {
      api = {
        service_name = module.api.service_name
        region       = var.region
        host         = var.domain_api
        timeout_sec  = 30
      }
    },
    var.enable_ws_gateway ? {
      ws = {
        service_name = module.ws_gateway[0].service_name
        region       = var.region
        host         = var.domain_ws
        timeout_sec  = 3600 # WebSocket long-lived
      }
    } : {}
  )

  default_backend    = "api"
  security_policy_id = module.armor.policy_id
}

# Cloud Run "internal-and-cloud-load-balancing" → autoriser le LB
resource "google_cloud_run_v2_service_iam_member" "api_invoker" {
  project  = var.project_id
  location = var.region
  name     = module.api.service_name
  role     = "roles/run.invoker"
  member   = "allUsers" # accès via LB qui applique Cloud Armor
}

resource "google_cloud_run_v2_service_iam_member" "ws_invoker" {
  count    = var.enable_ws_gateway ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = module.ws_gateway[0].service_name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- NATS sur GKE Autopilot (opt-in) ---
module "nats" {
  count            = var.enable_nats ? 1 : 0
  source           = "../../modules/nats"
  name             = local.name
  region           = var.region
  project_id       = var.project_id
  vpc_self_link    = module.network.vpc_self_link
  subnet_self_link = module.network.subnet_self_link
}

# --- Observability ---
module "obs" {
  source       = "../../modules/observability"
  name         = local.name
  alert_emails = var.alert_emails
}
