variable "project_id" { type = string }
variable "primary_region" {
  type    = string
  default = "europe-west1"
}
variable "dr_region" {
  type    = string
  default = "europe-west4"
}
variable "env" {
  type    = string
  default = "prod"
}

# Outputs récupérés de la stack primary (envs/prod)
variable "primary_cloudsql_connection_name" { type = string }
variable "primary_gcs_bucket_name"          { type = string }
variable "primary_lb_ip"                    { type = string }

variable "dr_lb_ip" {
  type        = string
  description = "IP du LB DR (déployer d'abord la stack DR-app dans dr_region, puis renseigner)"
}

variable "dns_managed_zone_name" { type = string }
variable "domain_api" {
  type        = string
  description = "FQDN du record DNS (ex: api.example.com)"
}

variable "notification_channels" {
  type    = list(string)
  default = []
}
