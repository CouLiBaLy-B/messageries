variable "name" { type = string }
variable "region" { type = string }
variable "vpc_self_link" { type = string }
variable "kms_key_id" { type = string }
variable "tier" {
  type    = string
  default = "STANDARD_HA"
}
variable "memory_gb" {
  type    = number
  default = 1
}
