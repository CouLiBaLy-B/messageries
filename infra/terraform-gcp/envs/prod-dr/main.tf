/**
 * Composition prod-DR : Cloud Run + LB + Cloud Armor + Memorystore DR.
 *
 * Cette stack est PASSIVE — min_instances=0 par défaut, prête à scaler.
 *
 * Pré-requis :
 *  - envs/prod (primary) déployée et stable
 *  - envs/dr déployée (VPC DR, Cloud SQL replica, GCS replication)
 *  - Image Docker primary copiée vers Artifact Registry DR
 *    (cf. scripts/copy-image-to-dr.sh fourni)
 *
 * Outputs notables :
 *  - lb_ip : à renseigner dans envs/dr (var.dr_lb_ip pour DNS failover)
 */

provider "google" {
  project = var.project_id
  region  = var.dr_region
}
provider "google-beta" {
  project = var.project_id
  region  = var.dr_region
}

locals {
  name      = "messaging-${var.env}"
  name_dr   = "${local.name}-dr"
  common_labels = {
    project     = "messaging"
    environment = "${var.env}-dr"
    managed_by  = "terraform"
  }
}

# ============================================================
# Secrets DR
# ============================================================
# Option A : utiliser des secrets existants (référence par ID)
# Option B : recréer avec valeurs explicites

locals {
  use_existing = var.use_existing_secrets

  # `try()` évite l'erreur d'évaluation de la branche non-prise quand
  # le count=0 rend google_secret_manager_secret.dr_*[0] invalide.
  jwt_secret_id_resolved = local.use_existing ? var.existing_jwt_secret_id : try(google_secret_manager_secret.dr_jwt[0].id, "")
  db_password_id_resolved = local.use_existing ? var.existing_db_password_id : try(google_secret_manager_secret.dr_db[0].id, "")
  redis_auth_id_resolved  = local.use_existing ? var.existing_redis_auth_id : try(google_secret_manager_secret.dr_redis[0].id, "")
}

# --- Mode B : créer en DR ---

# JWT : valeur DOIT être identique à primary (continuité sessions).
# Source : on lit le secret primary via data source pour copier sa valeur.
data "google_secret_manager_secret_version" "primary_jwt" {
  count   = local.use_existing ? 0 : 1
  secret  = "projects/${var.project_id}/secrets/${local.name}-jwt-secret"
  project = var.project_id
}

resource "google_secret_manager_secret" "dr_jwt" {
  count     = local.use_existing ? 0 : 1
  secret_id = "${local.name_dr}-jwt-secret"
  replication {
    user_managed {
      replicas {
        location = var.dr_region
        customer_managed_encryption { kms_key_name = var.dr_app_kms_key_id }
      }
    }
  }
}
resource "google_secret_manager_secret_version" "dr_jwt" {
  count       = local.use_existing ? 0 : 1
  secret      = google_secret_manager_secret.dr_jwt[0].id
  secret_data = data.google_secret_manager_secret_version.primary_jwt[0].secret_data
}

# DB password : Cloud SQL DR replica est répliquée du primary, donc même password.
# Le password est fourni en variable (ne pas le lire via data source pour ne pas
# créer une dépendance d'état entre stacks).
resource "google_secret_manager_secret" "dr_db" {
  count     = local.use_existing ? 0 : 1
  secret_id = "${local.name_dr}-db-password"
  replication {
    user_managed {
      replicas {
        location = var.dr_region
        customer_managed_encryption { kms_key_name = var.dr_app_kms_key_id }
      }
    }
  }
}
resource "google_secret_manager_secret_version" "dr_db" {
  count       = local.use_existing ? 0 : 1
  secret      = google_secret_manager_secret.dr_db[0].id
  secret_data = var.primary_db_password_value
}

# Redis AUTH : random nouveau (Redis DR séparé, sessions reconstructibles)
resource "random_password" "dr_redis_auth" {
  count   = local.use_existing ? 0 : 1
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "dr_redis" {
  count     = local.use_existing ? 0 : 1
  secret_id = "${local.name_dr}-redis-auth"
  replication {
    user_managed {
      replicas {
        location = var.dr_region
        customer_managed_encryption { kms_key_name = var.dr_app_kms_key_id }
      }
    }
  }
}
resource "google_secret_manager_secret_version" "dr_redis" {
  count       = local.use_existing ? 0 : 1
  secret      = google_secret_manager_secret.dr_redis[0].id
  secret_data = random_password.dr_redis_auth[0].result
}

# ============================================================
# Artifact Registry DR
# ============================================================
module "ar_dr" {
  source = "../../modules/artifact-registry"
  name   = local.name_dr
  region = var.dr_region
}

# ============================================================
# Memorystore Redis DR (frais, sessions non répliquées)
# ============================================================
module "redis_dr" {
  source        = "../../modules/memorystore"
  name          = local.name_dr
  region        = var.dr_region
  vpc_self_link = var.dr_vpc_self_link
  kms_key_id    = var.dr_app_kms_key_id
  tier          = "STANDARD_HA"
  memory_gb     = 5
}

# Note : auth_token Memorystore est généré par GCP, exposé via output.
# On l'écrit dans le secret pour que Cloud Run le consomme.
resource "google_secret_manager_secret_version" "dr_redis_real_auth" {
  count = local.use_existing ? 0 : 1
  secret      = google_secret_manager_secret.dr_redis[0].id
  secret_data = module.redis_dr.auth_string
  # Override la version précédente (random_password) avec la vraie auth Memorystore
  depends_on = [google_secret_manager_secret_version.dr_redis]
}

# ============================================================
# IAM (SA api DR + WIF GitHub si demandé)
# ============================================================
module "iam_dr" {
  source = "../../modules/iam"
  name   = local.name_dr

  jwt_secret_id        = local.jwt_secret_id_resolved
  db_password_id       = local.db_password_id_resolved
  redis_auth_id        = local.redis_auth_id_resolved
  gcs_bucket_name      = var.dr_gcs_bucket_name
  app_kms_key_id       = var.dr_app_kms_key_id
  create_ws_gateway_sa = var.enable_ws_gateway
  create_github_deploy = var.github_repo != ""
  github_repo          = var.github_repo
}

# ============================================================
# Cloud Run api DR (passif : min_instances=0)
# ============================================================
locals {
  api_env = {
    NODE_ENV              = var.env
    PORT                  = "3000"
    API_PREFIX            = "api/v1"
    APP_URL               = "https://${var.domain_api}"
    ALLOWED_ORIGINS       = join(",", var.allowed_origins)
    DB_HOST               = var.dr_cloudsql_private_ip
    DB_PORT               = "5432"
    DB_USERNAME           = var.dr_cloudsql_username
    DB_NAME               = var.dr_cloudsql_db_name
    DB_SSL                = "true"
    REDIS_HOST            = module.redis_dr.host
    REDIS_PORT            = tostring(module.redis_dr.port)
    REDIS_TLS             = "true"
    STORAGE_DRIVER        = "gcs"
    GCS_BUCKET            = var.dr_gcs_bucket_name
    GCP_PROJECT_ID        = var.project_id
    KMS_DRIVER            = "gcp"
    GCP_KMS_KEY_NAME      = var.dr_app_kms_key_id
    ENCRYPT_MESSAGE_BODY  = "true"
    # ⚠️ Outbox worker désactivé tant que la DB est replica read-only.
    # À activer manuellement (ou via var) après promote.
    OUTBOX_WORKER_ENABLED = "false"
    METRICS_ENABLED       = "true"
    METRICS_DRIVER        = "gcp"
    METRICS_NAMESPACE     = "custom.googleapis.com/messaging"
    TRACING_ENABLED       = "true"
    OTEL_SERVICE_NAME     = "${local.name_dr}-api"
    APP_VERSION           = "0.9.0"
  }
}

module "api_dr" {
  source                = "../../modules/cloudrun"
  name                  = "${local.name_dr}-api"
  region                = var.dr_region
  service_account_email = module.iam_dr.api_sa_email
  image_uri             = var.api_image_uri
  container_port        = 3000
  health_path           = "/api/v1/health"
  cpu                   = "1"
  memory                = "1Gi"
  min_instances         = var.min_instances
  max_instances         = var.max_instances
  concurrency           = 80
  vpc_connector         = var.dr_vpc_connector_id
  environment           = local.api_env
  secret_env = {
    JWT_SECRET     = { secret_id = local.jwt_secret_id_resolved }
    DB_PASSWORD    = { secret_id = local.db_password_id_resolved }
    REDIS_PASSWORD = { secret_id = local.redis_auth_id_resolved }
  }
}

# ============================================================
# Cloud Armor + LB DR
# ============================================================
module "armor_dr" {
  source              = "../../modules/cloudarmor"
  name                = local.name_dr
  rate_limit_per_5min = 5000
}

module "lb_dr" {
  source = "../../modules/loadbalancer"
  name   = local.name_dr

  cloud_run_services = {
    api = {
      service_name = module.api_dr.service_name
      region       = var.dr_region
      host         = var.domain_api
      timeout_sec  = 30
    }
  }
  default_backend    = "api"
  security_policy_id = module.armor_dr.policy_id
}

# Cloud Run autorise l'accès via LB
resource "google_cloud_run_v2_service_iam_member" "api_invoker" {
  project  = var.project_id
  location = var.dr_region
  name     = module.api_dr.service_name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ============================================================
# Outputs
# ============================================================
output "dr_lb_ip" {
  value       = module.lb_dr.ip_address
  description = "À renseigner dans envs/dr/terraform.tfvars (var.dr_lb_ip pour DNS failover)"
}
output "dr_api_service_uri" {
  value = module.api_dr.service_uri
}
output "dr_artifact_registry_url" {
  value = module.ar_dr.repository_url
}
output "dr_redis_host" {
  value     = module.redis_dr.host
  sensitive = true
}
output "dr_deploy_sa_email" {
  value = module.iam_dr.deploy_sa_email
}
output "dr_workload_identity_provider" {
  value = module.iam_dr.workload_identity_provider
}
output "dr_api_sa_email" {
  value = module.iam_dr.api_sa_email
}
