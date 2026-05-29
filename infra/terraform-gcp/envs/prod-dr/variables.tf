variable "project_id" { type = string }

variable "dr_region" {
  type    = string
  default = "europe-west4"
  description = "Région DR (différente du primary). Doit matcher envs/dr."
}

variable "env" {
  type    = string
  default = "prod"
}

# --- Référence des ressources créées par envs/dr ---
variable "dr_vpc_self_link" { type = string }
variable "dr_vpc_connector_id" { type = string }

variable "dr_cloudsql_private_ip" {
  type        = string
  description = "Private IP du Cloud SQL DR replica. Read-only avant promote."
}
variable "dr_cloudsql_db_name" {
  type    = string
  default = "messaging"
}
variable "dr_cloudsql_username" {
  type    = string
  default = "messaging_admin"
}

variable "dr_gcs_bucket_name" { type = string }

variable "dr_app_kms_key_id" {
  type        = string
  description = "CryptoKey app dans la région DR (créée par envs/dr/kms_dr)"
}

# --- Spécifique prod-dr ---
variable "domain_api" {
  type        = string
  description = "FQDN api (le LB sera capable de répondre, mais Cloud DNS ne route que sur failover)"
}
variable "domain_ws" {
  type    = string
  default = ""
}
variable "allowed_origins" { type = list(string) }
variable "alert_emails" {
  type    = list(string)
  default = []
}

# --- Images & deploy ---
variable "github_repo" {
  type    = string
  default = ""
}
variable "api_image_uri" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}
variable "ws_image_uri" {
  type    = string
  default = ""
}
variable "enable_ws_gateway" {
  type    = bool
  default = false
}

# --- Sizing DR : scale-to-zero possible (économie) ---
variable "min_instances" {
  type        = number
  default     = 0
  description = "0 = scale to zero quand passif. Mettre à 2-3 en mode actif post-failover."
}
variable "max_instances" {
  type    = number
  default = 30
}

# --- Secrets : 2 modes possibles ---
variable "use_existing_secrets" {
  type        = bool
  default     = false
  description = "true = utiliser des Secret Manager IDs existants (recommandé prod), false = recréer en DR (random — pour staging uniquement)"
}

variable "existing_jwt_secret_id" {
  type    = string
  default = ""
}
variable "existing_db_password_id" {
  type    = string
  default = ""
}
variable "existing_redis_auth_id" {
  type    = string
  default = ""
}

variable "primary_db_password_value" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Si use_existing_secrets=false : password DB primary (DB cloud SQL DR = même mot de passe car répliquée)"
}
