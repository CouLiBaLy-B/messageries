/**
 * Cloud SQL cross-region read replica.
 *
 * Différences clés vs AWS :
 *  - Le replica référence le primary via `master_instance_name`
 *    (string "project:region:instance" — pas un ARN).
 *  - La région du replica est définie au niveau de l'instance,
 *    indépendamment de la primary.
 *  - Cloud SQL gère la promotion via `gcloud sql instances promote-replica`
 *    qui supprime le lien de réplication. Pas reversible : il faut
 *    recréer un replica après promotion.
 *  - CMEK : la KEY DOIT être dans la même région que le replica
 *    (Cloud KMS keys sont régionales).
 */

resource "google_sql_database_instance" "replica" {
  name                 = var.name
  master_instance_name = var.primary_instance_connection_name
  database_version     = "POSTGRES_16"
  region               = var.region
  deletion_protection  = var.deletion_protection
  encryption_key_name  = var.kms_key_id

  replica_configuration {
    failover_target = false # cross-region = read replica seulement (pas failover auto)
  }

  settings {
    tier              = var.tier
    availability_type = "ZONAL" # replica cross-region typiquement zonal
    disk_type         = "PD_SSD"
    disk_size         = var.disk_size_gb
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled    = false
      private_network = var.vpc_self_link
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled = false # le primary gère les backups
    }

    insights_config {
      query_insights_enabled = true
    }
  }

  lifecycle {
    # `master_instance_name` est immuable de toute façon (un changement
    # nécessite de recréer la ressource).
    ignore_changes = []
  }
}
