/**
 * Composition DR GCP : RDS replica + GCS transfer job + DNS failover.
 *
 * ⚠️ Pré-requis : la stack primary `envs/prod` doit être en place.
 * Pré-requis : le LB DR doit déjà exister dans dr_region.
 *
 * NB : pour simplifier, ce module crée uniquement les ressources DR
 * (replica + replication + DNS). La stack ECS/Cloud Run DR doit être
 * gérée par une stack séparée `envs/prod-dr` (à dériver de prod en
 * changeant la région).
 */

provider "google" {
  alias   = "primary"
  project = var.project_id
  region  = var.primary_region
}

provider "google" {
  project = var.project_id
  region  = var.dr_region
}

locals {
  name = "messaging-${var.env}"
}

# --- VPC DR (CIDR différent pour ne pas conflict en peering futur) ---
module "vpc_dr" {
  source         = "../../modules/network"
  name           = "${local.name}-dr"
  region         = var.dr_region
  app_cidr       = "10.40.0.0/20"
  connector_cidr = "10.40.16.0/28"
}

# --- KMS DR (régionale dans dr_region) ---
module "kms_dr" {
  source = "../../modules/kms"
  name   = "${local.name}-dr"
  region = var.dr_region
}

# --- Cloud SQL replica cross-region ---
module "sql_dr" {
  source                           = "../../modules/dr-cloudsql-replica"
  name                             = "${local.name}-dr-pg"
  region                           = var.dr_region
  vpc_self_link                    = module.vpc_dr.vpc_self_link
  kms_key_id                       = module.kms_dr.db_key_id
  primary_instance_connection_name = var.primary_cloudsql_connection_name
  tier                             = "db-custom-1-3840"
  deletion_protection              = true
}

# --- GCS replication via Storage Transfer ---
module "gcs_dr" {
  source             = "../../modules/dr-gcs-replication"
  source_project_id  = var.project_id
  source_bucket_name = var.primary_gcs_bucket_name
  dr_project_id      = var.project_id
  dr_region          = var.dr_region
  dr_bucket_name     = "${var.primary_gcs_bucket_name}-dr"
  dr_kms_key_id      = module.kms_dr.gcs_key_id
  schedule_interval_minutes = 60
}

# --- DNS failover (WRR 100/0 + alert) ---
module "dns_failover" {
  source                = "../../modules/dr-dns-failover"
  project_id            = var.project_id
  dns_managed_zone_name = var.dns_managed_zone_name
  record_name           = var.domain_api
  primary_ip            = var.primary_lb_ip
  dr_ip                 = var.dr_lb_ip
  notification_channels = var.notification_channels
}

output "dr_cloudsql_endpoint" { value = module.sql_dr.private_ip }
output "dr_cloudsql_connection_name" { value = module.sql_dr.connection_name }
output "dr_gcs_bucket"        { value = module.gcs_dr.dr_bucket_name }
output "dns_record_managed"   { value = module.dns_failover.record_name }
