variable "region" {
  type    = string
  default = "eu-west-3"
}

variable "env" {
  type    = string
  default = "staging"
}

variable "domain_name" { type = string }
variable "certificate_arn" { type = string }

variable "alert_emails" {
  type    = list(string)
  default = []
}

variable "allowed_origins" { type = list(string) }

variable "github_repo" {
  type    = string
  default = ""
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "tracing_enabled" {
  type    = bool
  default = false
}
