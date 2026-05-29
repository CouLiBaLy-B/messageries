/**
 * IAM :
 *  - SA Cloud Run "api" : accès secrets, KMS app key, GCS, Cloud Trace, Logging
 *  - SA Cloud Run "ws-gateway" : secrets JWT/REDIS_AUTH, Trace, Logging
 *  - Workload Identity Federation pour GitHub Actions (deploy)
 */

data "google_project" "this" {}

# --- SA API ---
resource "google_service_account" "api" {
  account_id   = "${var.name}-api"
  display_name = "Messaging API"
}

resource "google_project_iam_member" "api_logging" {
  project = data.google_project.this.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.api.email}"
}
resource "google_project_iam_member" "api_metrics" {
  project = data.google_project.this.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.api.email}"
}
resource "google_project_iam_member" "api_trace" {
  project = data.google_project.this.project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# Accès aux secrets (granulaire)
resource "google_secret_manager_secret_iam_member" "api_jwt" {
  secret_id = var.jwt_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}
resource "google_secret_manager_secret_iam_member" "api_db" {
  secret_id = var.db_password_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}
resource "google_secret_manager_secret_iam_member" "api_redis" {
  secret_id = var.redis_auth_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

# GCS bucket : objectAdmin sur le bucket attachments uniquement
resource "google_storage_bucket_iam_member" "api_gcs" {
  bucket = var.gcs_bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

# KMS app key : encrypter/decrypter
resource "google_kms_crypto_key_iam_member" "api_kms_app" {
  crypto_key_id = var.app_kms_key_id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.api.email}"
}

# Cloud SQL client
resource "google_project_iam_member" "api_sql_client" {
  project = data.google_project.this.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# --- SA ws-gateway ---
resource "google_service_account" "ws" {
  count        = var.create_ws_gateway_sa ? 1 : 0
  account_id   = "${var.name}-ws"
  display_name = "Messaging WS Gateway"
}

resource "google_project_iam_member" "ws_logging" {
  count   = var.create_ws_gateway_sa ? 1 : 0
  project = data.google_project.this.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.ws[0].email}"
}
resource "google_project_iam_member" "ws_trace" {
  count   = var.create_ws_gateway_sa ? 1 : 0
  project = data.google_project.this.project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${google_service_account.ws[0].email}"
}
resource "google_secret_manager_secret_iam_member" "ws_jwt" {
  count     = var.create_ws_gateway_sa ? 1 : 0
  secret_id = var.jwt_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ws[0].email}"
}
resource "google_secret_manager_secret_iam_member" "ws_redis" {
  count     = var.create_ws_gateway_sa ? 1 : 0
  secret_id = var.redis_auth_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ws[0].email}"
}

# --- Workload Identity Federation pour GitHub Actions ---
resource "google_iam_workload_identity_pool" "github" {
  count                     = var.create_github_deploy ? 1 : 0
  workload_identity_pool_id = "${var.name}-github"
  display_name              = "GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  count                              = var.create_github_deploy ? 1 : 0
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[0].workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  # Limite à un repo spécifique pour bloquer les autres
  attribute_condition = "assertion.repository == \"${var.github_repo}\""
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# SA dédié au deploy
resource "google_service_account" "deploy" {
  count        = var.create_github_deploy ? 1 : 0
  account_id   = "${var.name}-deploy"
  display_name = "GitHub Actions Deploy"
}

# Permet à GitHub d'impersonate ce SA
resource "google_service_account_iam_member" "github_impersonate" {
  count              = var.create_github_deploy ? 1 : 0
  service_account_id = google_service_account.deploy[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[0].name}/attribute.repository/${var.github_repo}"
}

# Permissions du deploy SA
resource "google_project_iam_member" "deploy_run_admin" {
  count   = var.create_github_deploy ? 1 : 0
  project = data.google_project.this.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.deploy[0].email}"
}
resource "google_project_iam_member" "deploy_ar_writer" {
  count   = var.create_github_deploy ? 1 : 0
  project = data.google_project.this.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.deploy[0].email}"
}
resource "google_service_account_iam_member" "deploy_actas_api" {
  count              = var.create_github_deploy ? 1 : 0
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy[0].email}"
}
