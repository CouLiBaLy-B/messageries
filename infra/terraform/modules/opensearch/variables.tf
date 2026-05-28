variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "allowed_security_group_ids" { type = list(string) }
variable "kms_key_arn" { type = string }
variable "logs_kms_key_arn" { type = string }

variable "instance_type" {
  type    = string
  default = "t3.small.search"
}
variable "instance_count" {
  type    = number
  default = 2
}
variable "volume_size_gb" {
  type    = number
  default = 20
}
variable "tags" {
  type    = map(string)
  default = {}
}
