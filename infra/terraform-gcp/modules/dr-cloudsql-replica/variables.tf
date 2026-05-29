variable "name" { type = string }
variable "region" { type = string }
variable "vpc_self_link" { type = string }
variable "kms_key_id" {
  type        = string
  description = "CryptoKey dans la région DR (les keys Cloud KMS sont régionales)"
}
variable "primary_instance_connection_name" {
  type        = string
  description = "Format: project:region:instance (cf. output `connection_name` du module cloudsql primary)"
}
variable "tier" {
  type    = string
  default = "db-custom-1-3840"
}
variable "disk_size_gb" {
  type    = number
  default = 20
}
variable "deletion_protection" {
  type    = bool
  default = true
}
