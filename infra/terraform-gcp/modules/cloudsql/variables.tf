variable "name" { type = string }
variable "region" { type = string }
variable "vpc_self_link" { type = string }
variable "kms_key_id" { type = string }
variable "master_password" {
  type      = string
  sensitive = true
}

variable "tier" {
  type    = string
  default = "db-custom-1-3840" # 1 vCPU, 3.75 GB
}
variable "ha" {
  type    = bool
  default = true
}
variable "disk_size_gb" {
  type    = number
  default = 20
}
variable "disk_size_max_gb" {
  type    = number
  default = 100
}
variable "backup_retention_days" {
  type    = number
  default = 14
}
variable "deletion_protection" {
  type    = bool
  default = true
}
variable "psa_dependency" {
  type    = any
  default = null
}
