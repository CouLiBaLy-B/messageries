variable "name" {
  type        = string
  description = "Nom logique (ex: messaging-staging)"
}

variable "cidr_block" {
  type    = string
  default = "10.20.0.0/16"
}

variable "single_nat_gateway" {
  type    = bool
  default = false
}

variable "enable_flow_logs" {
  type    = bool
  default = true
}

variable "logs_kms_key_arn" {
  type    = string
  default = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
