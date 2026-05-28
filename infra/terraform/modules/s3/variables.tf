variable "name" { type = string }
variable "kms_key_arn" { type = string }
variable "allowed_origins" { type = list(string) }

variable "tags" {
  type    = map(string)
  default = {}
}
