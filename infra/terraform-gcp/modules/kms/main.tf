/**
 * KeyRing + 4 CryptoKeys (db, gcs, app, logs).
 * Rotation auto 90j. Purpose ENCRYPT_DECRYPT.
 */

resource "google_kms_key_ring" "this" {
  name     = "${var.name}-kr"
  location = var.region
}

resource "google_kms_crypto_key" "db" {
  name            = "${var.name}-db"
  key_ring        = google_kms_key_ring.this.id
  rotation_period = "7776000s" # 90 jours
  purpose         = "ENCRYPT_DECRYPT"
  lifecycle { prevent_destroy = false }
}

resource "google_kms_crypto_key" "gcs" {
  name            = "${var.name}-gcs"
  key_ring        = google_kms_key_ring.this.id
  rotation_period = "7776000s"
  purpose         = "ENCRYPT_DECRYPT"
}

# Clé app = KEK pour envelope encryption applicative
resource "google_kms_crypto_key" "app" {
  name            = "${var.name}-app"
  key_ring        = google_kms_key_ring.this.id
  rotation_period = "7776000s"
  purpose         = "ENCRYPT_DECRYPT"
}

resource "google_kms_crypto_key" "logs" {
  name            = "${var.name}-logs"
  key_ring        = google_kms_key_ring.this.id
  rotation_period = "7776000s"
  purpose         = "ENCRYPT_DECRYPT"
}

# Donne au service agent Cloud Storage l'accès à la clé GCS
data "google_storage_project_service_account" "gcs_sa" {}

resource "google_kms_crypto_key_iam_member" "gcs_sa" {
  crypto_key_id = google_kms_crypto_key.gcs.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${data.google_storage_project_service_account.gcs_sa.email_address}"
}

# Cloud SQL service agent
data "google_project" "this" {}

resource "google_kms_crypto_key_iam_member" "sql_sa" {
  crypto_key_id = google_kms_crypto_key.db.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-cloud-sql.iam.gserviceaccount.com"
}

# Memorystore service agent
resource "google_kms_crypto_key_iam_member" "redis_sa" {
  crypto_key_id = google_kms_crypto_key.db.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:service-${data.google_project.this.number}@cloud-redis.iam.gserviceaccount.com"
}
