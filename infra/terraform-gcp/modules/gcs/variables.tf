variable "name" { type = string }
variable "region" { type = string }
variable "kms_key_id" { type = string }
variable "allowed_origins" { type = list(string) }
