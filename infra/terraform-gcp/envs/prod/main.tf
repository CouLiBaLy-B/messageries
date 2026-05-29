/**
 * Composition prod GCP : durcie.
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
}

module "network" {
  source = "../../modules/network"
  name   = local.name
  region = var.region
  app_cidr       = "10.30.0.0/20"
  connector_cidr = "10.30.16.0/28"
}

module "kms" {
  source = "../../modules/kms"
  name   = local.name
  region = var.region
}

module "secrets" {
  source     = "../../modules/secrets"
  name       = local.name
  region     = var.region
  kms_key_id = module.kms.app_key_id
}

module "ar" {
  source = "../../modules/artifact-registry"
  name   = local.name
  region = var.region
}

module "gcs" {
  source          = "../../modules/gcs"
  name            = local.name
  region          = var.region
  kms_key_id      = module.kms.gcs_key_id
  allowed_origins = var.allowed_origins
}

module "sql" {
  source              = "../../modules/cloudsql"
  name                = local.name
  region              = var.region
  vpc_self_link       = module.network.vpc_self_link
  kms_key_id          = module.kms.db_key_id
  master_password     = module.secrets.db_password_value
  tier                = "db-custom-2-7680" # 2 vCPU, 7.5 GB
  ha                  = true
  disk_size_gb        = 100
  disk_size_max_gb    = 1000
  backup_retention_days = 30
  deletion_protection = true
  psa_dependency      = module.network.psa_connection
}

module "redis" {
  source        = "../../modules/memorystore"
  name          = local.name
  region        = var.region
  vpc_self_link = module.network.vpc_self_link
  kms_key_id    = module.kms.db_key_id
  tier          = "STANDARD_HA"
  memory_gb     = 5
}

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

module "api" {
  source                = "../../modules/cloudrun"
  name                  = "${local.name}-api"
  region                = var.region
  service_account_email = module.iam.api_sa_email
  image_uri             = var.api_image_uri
  container_port        = 3000
  cpu                   = "2"
  memory                = "2Gi"
  min_instances         = 3
  max_instances         = 30
  concurrency           = 100
  vpc_connector         = module.network.vpc_connector_id

  environment = {
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
    STORAGE_DRIVER         = "gcs"
    GCS_BUCKET             = module.gcs.bucket_name
    KMS_DRIVER             = "gcp"
    GCP_KMS_KEY_NAME       = module.kms.app_key_id
    ENCRYPT_MESSAGE_BODY   = "true"
    OUTBOX_WORKER_ENABLED  = "true"
    METRICS_ENABLED        = "true"
    METRICS_DRIVER         = "gcp"
    METRICS_NAMESPACE      = "custom.googleapis.com/messaging"
    TRACING_ENABLED        = "true"
    OTEL_SERVICE_NAME      = "${local.name}-api"
    APP_VERSION            = "0.8.0"
  }
  secret_env = {
    JWT_SECRET     = { secret_id = module.secrets.jwt_secret_id }
    DB_PASSWORD    = { secret_id = module.secrets.db_password_id }
    REDIS_PASSWORD = { secret_id = module.secrets.redis_auth_id }
  }
}

module "armor" {
  source = "../../modules/cloudarmor"
  name   = local.name
  rate_limit_per_5min = 5000
}

module "lb" {
  source = "../../modules/loadbalancer"
  name   = local.name
  cloud_run_services = {
    api = {
      service_name = module.api.service_name
      region       = var.region
      host         = var.domain_api
      timeout_sec  = 30
    }
  }
  default_backend    = "api"
  security_policy_id = module.armor.policy_id
}

resource "google_cloud_run_v2_service_iam_member" "api_invoker" {
  project  = var.project_id
  location = var.region
  name     = module.api.service_name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

module "obs" {
  source       = "../../modules/observability"
  name         = local.name
  alert_emails = var.alert_emails
}

output "lb_ip"                  { value = module.lb.ip_address }
output "api_service_uri"        { value = module.api.service_uri }
output "artifact_registry_url"  { value = module.ar.repository_url }
output "gcs_bucket_name"        { value = module.gcs.bucket_name }
output "deploy_sa_email"        { value = module.iam.deploy_sa_email }
output "workload_identity_provider" { value = module.iam.workload_identity_provider }
