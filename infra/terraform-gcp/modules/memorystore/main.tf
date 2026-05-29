/**
 * Memorystore Redis HA :
 *  - tier STANDARD_HA (replica auto + failover)
 *  - TRANSIT_ENCRYPTION_MODE=SERVER_AUTHENTICATION (TLS)
 *  - AUTH activé (token)
 *  - private IP via authorized_network = VPC
 *  - persistance RDB
 */

resource "google_redis_instance" "this" {
  name                    = "${var.name}-redis"
  region                  = var.region
  tier                    = var.tier
  memory_size_gb          = var.memory_gb
  redis_version           = "REDIS_7_2"
  authorized_network      = var.vpc_self_link
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  auth_enabled            = true
  customer_managed_key    = var.kms_key_id

  persistence_config {
    persistence_mode    = "RDB"
    rdb_snapshot_period = "TWELVE_HOURS"
  }

  redis_configs = {
    maxmemory-policy = "noeviction"
  }

  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"
      start_time {
        hours   = 5
        minutes = 30
      }
    }
  }
}
