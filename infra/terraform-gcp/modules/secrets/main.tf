/**
 * Secret Manager : JWT, DB password, Redis AUTH.
 * Random + CMEK via KMS si var.kms_key_id fourni.
 */

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "random_password" "redis_auth" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "jwt" {
  secret_id = "${var.name}-jwt-secret"
  replication {
    user_managed {
      replicas {
        location = var.region
        dynamic "customer_managed_encryption" {
          for_each = var.kms_key_id != "" ? [1] : []
          content { kms_key_name = var.kms_key_id }
        }
      }
    }
  }
}

resource "google_secret_manager_secret_version" "jwt" {
  secret      = google_secret_manager_secret.jwt.id
  secret_data = random_password.jwt.result
}

resource "google_secret_manager_secret" "db" {
  secret_id = "${var.name}-db-password"
  replication {
    user_managed {
      replicas {
        location = var.region
        dynamic "customer_managed_encryption" {
          for_each = var.kms_key_id != "" ? [1] : []
          content { kms_key_name = var.kms_key_id }
        }
      }
    }
  }
}

resource "google_secret_manager_secret_version" "db" {
  secret      = google_secret_manager_secret.db.id
  secret_data = random_password.db.result
}

resource "google_secret_manager_secret" "redis" {
  secret_id = "${var.name}-redis-auth"
  replication {
    user_managed {
      replicas {
        location = var.region
        dynamic "customer_managed_encryption" {
          for_each = var.kms_key_id != "" ? [1] : []
          content { kms_key_name = var.kms_key_id }
        }
      }
    }
  }
}

resource "google_secret_manager_secret_version" "redis" {
  secret      = google_secret_manager_secret.redis.id
  secret_data = random_password.redis_auth.result
}
