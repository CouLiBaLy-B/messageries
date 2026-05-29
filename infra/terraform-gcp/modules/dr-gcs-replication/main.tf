/**
 * Réplication GCS cross-region.
 *
 * Deux approches :
 *  - A. Bucket dual-region / multi-region natif : GCS réplique automatiquement
 *       entre 2 régions du même continent. RPO ≈ 15min.
 *       → Ce module crée un BUCKET DE DESTINATION séparé dans une autre région.
 *
 *  - B. (Recommandé prod) Storage Transfer Service : un job recurrent transfère
 *       le primary bucket vers une autre région/projet. Plus de flexibilité,
 *       RPO configurable.
 *
 * On implémente B (plus proche du fonctionnement "CRR" AWS S3) :
 * un Transfer Job programmé toutes les 60 minutes.
 *
 * Pré-requis IAM (créés par le module) :
 *  - SA du Storage Transfer Service du projet doit avoir storage.objectViewer
 *    sur la source ET storage.objectAdmin + storage.legacyBucketWriter sur la dest.
 */

resource "google_storage_bucket" "dr" {
  name                        = var.dr_bucket_name
  project                     = var.dr_project_id
  location                    = var.dr_region
  storage_class               = "NEARLINE" # DR storage class moins chère
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning { enabled = true }

  encryption { default_kms_key_name = var.dr_kms_key_id }

  lifecycle_rule {
    condition { age = 730 }
    action { type = "Delete" }
  }
  lifecycle_rule {
    condition { num_newer_versions = 5 }
    action { type = "Delete" }
  }

  labels = {
    project = "messaging"
    purpose = "dr-attachments"
  }
}

# Service Agent du Storage Transfer Service (account auto-créé par GCP)
data "google_storage_transfer_project_service_account" "this" {
  project = var.source_project_id
}

# Permissions read sur la source
resource "google_storage_bucket_iam_member" "sts_source_reader" {
  bucket = var.source_bucket_name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${data.google_storage_transfer_project_service_account.this.email}"
}
resource "google_storage_bucket_iam_member" "sts_source_legacy_reader" {
  bucket = var.source_bucket_name
  role   = "roles/storage.legacyBucketReader"
  member = "serviceAccount:${data.google_storage_transfer_project_service_account.this.email}"
}

# Permissions write sur la dest
resource "google_storage_bucket_iam_member" "sts_dr_writer" {
  bucket = google_storage_bucket.dr.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${data.google_storage_transfer_project_service_account.this.email}"
}
resource "google_storage_bucket_iam_member" "sts_dr_legacy_writer" {
  bucket = google_storage_bucket.dr.name
  role   = "roles/storage.legacyBucketWriter"
  member = "serviceAccount:${data.google_storage_transfer_project_service_account.this.email}"
}

# Si KMS DR : autoriser le STS service agent à encrypt
resource "google_kms_crypto_key_iam_member" "sts_kms" {
  count         = var.dr_kms_key_id != "" ? 1 : 0
  crypto_key_id = var.dr_kms_key_id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${data.google_storage_transfer_project_service_account.this.email}"
}

# --- Job de transfert récurrent ---
resource "google_storage_transfer_job" "this" {
  description = "DR replication ${var.source_bucket_name} → ${google_storage_bucket.dr.name}"
  project     = var.source_project_id
  status      = "ENABLED"

  transfer_spec {
    gcs_data_source {
      bucket_name = var.source_bucket_name
    }
    gcs_data_sink {
      bucket_name = google_storage_bucket.dr.name
    }
    object_conditions {
      min_time_elapsed_since_last_modification = "0s"
    }
    transfer_options {
      overwrite_objects_already_existing_in_sink = false
      delete_objects_unique_in_sink              = false # idempotent — pas de "tombstone" replication
    }
  }

  schedule {
    schedule_start_date {
      year  = 2026
      month = 1
      day   = 1
    }
    start_time_of_day {
      hours   = 0
      minutes = 0
      seconds = 0
      nanos   = 0
    }
    repeat_interval = "${var.schedule_interval_minutes * 60}s"
  }

  depends_on = [
    google_storage_bucket_iam_member.sts_source_reader,
    google_storage_bucket_iam_member.sts_source_legacy_reader,
    google_storage_bucket_iam_member.sts_dr_writer,
    google_storage_bucket_iam_member.sts_dr_legacy_writer,
  ]
}
