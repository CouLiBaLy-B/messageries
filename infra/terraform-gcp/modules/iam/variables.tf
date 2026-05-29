variable "name" { type = string }
variable "jwt_secret_id" { type = string }
variable "db_password_id" { type = string }
variable "redis_auth_id" { type = string }
variable "gcs_bucket_name" { type = string }
variable "app_kms_key_id" { type = string }

variable "create_ws_gateway_sa" {
  type    = bool
  default = true
}
variable "create_github_deploy" {
  type    = bool
  default = false
}
variable "github_repo" {
  type    = string
  default = ""
}
