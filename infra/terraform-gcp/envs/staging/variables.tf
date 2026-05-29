variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "europe-west1"
}
variable "env" {
  type    = string
  default = "staging"
}
variable "domain_api" { type = string }
variable "domain_ws"  {
  type    = string
  default = ""
}
variable "allowed_origins" { type = list(string) }
variable "alert_emails" {
  type    = list(string)
  default = []
}
variable "github_repo" {
  type    = string
  default = ""
}
variable "api_image_uri" {
  type        = string
  description = "Image initiale Cloud Run (sera mise à jour via CI)"
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
variable "ws_image_uri" {
  type    = string
  default = ""
}
variable "enable_ws_gateway" {
  type    = bool
  default = false
}
variable "enable_nats" {
  type    = bool
  default = false
}
