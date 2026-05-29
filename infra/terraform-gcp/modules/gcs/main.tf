/**
 * Bucket GCS pour attachments :
 *  - CMEK (Cloud KMS)
 *  - uniform_bucket_level_access (pas d'ACL legacy)
 *  - public_access_prevention enforced
 *  - lifecycle 90j → Nearline, 730j → suppression
 *  - versioning
 *  - CORS pour upload signé depuis le frontend
 *  - SoftDelete (récupération 7j)
 */

resource "random_id" "suffix" {
  byte_length = 4
}

resource "google_storage_bucket" "attachments" {
  name                        = "${var.name}-attachments-${random_id.suffix.hex}"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning { enabled = true }

  soft_delete_policy {
    retention_duration_seconds = 7 * 24 * 3600
  }

  encryption { default_kms_key_name = var.kms_key_id }

  lifecycle_rule {
    condition { age = 90 }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }
  lifecycle_rule {
    condition { age = 730 }
    action { type = "Delete" }
  }
  lifecycle_rule {
    condition { num_newer_versions = 5 }
    action { type = "Delete" }
  }
  lifecycle_rule {
    condition { age = 1, is_live = false }
    action { type = "Delete" }
  }
  lifecycle_rule {
    condition { with_state = "ARCHIVED", age = 30 }
    action { type = "Delete" }
  }

  cors {
    origin          = var.allowed_origins
    method          = ["GET", "PUT"]
    response_header = ["Content-Type", "ETag"]
    max_age_seconds = 3000
  }

  labels = {
    project = "messaging"
    purpose = "attachments"
  }
}
