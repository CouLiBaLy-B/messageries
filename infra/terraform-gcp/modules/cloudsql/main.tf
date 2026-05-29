/**
 * Cloud SQL PostgreSQL 16 HA :
 *  - private IP via PSA (pas d'IP publique)
 *  - CMEK chiffrement
 *  - backups quotidiens + point-in-time recovery (WAL)
 *  - require_ssl + insights logs
 *  - flag rds.force_ssl équivalent : require_ssl = true
 */

resource "google_sql_database_instance" "this" {
  name                = "${var.name}-pg"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.deletion_protection
  encryption_key_name = var.kms_key_id

  settings {
    tier              = var.tier
    availability_type = var.ha ? "REGIONAL" : "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.disk_size_gb
    disk_autoresize   = true
    disk_autoresize_limit = var.disk_size_max_gb

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.vpc_self_link
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "02:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = var.backup_retention_days
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = 7
      hour         = 4
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = false
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"
    }
    database_flags {
      name  = "log_connections"
      value = "on"
    }
    database_flags {
      name  = "log_disconnections"
      value = "on"
    }
    database_flags {
      name  = "log_lock_waits"
      value = "on"
    }
  }

  depends_on = [var.psa_dependency]
}

resource "google_sql_database" "messaging" {
  name     = "messaging"
  instance = google_sql_database_instance.this.name
}

resource "google_sql_user" "admin" {
  name     = "messaging_admin"
  instance = google_sql_database_instance.this.name
  password = var.master_password
}
