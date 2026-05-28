variable "name" { type = string }
variable "s3_bucket_arn" { type = string }
variable "app_kms_key_arn" { type = string }
variable "s3_kms_key_arn" { type = string }

variable "kms_secrets_key_arn" {
  type    = string
  default = ""
}

variable "secret_arns" { type = list(string) }

variable "metrics_namespace" {
  type    = string
  default = "Messaging"
}

variable "create_github_deploy_role" {
  type    = bool
  default = false
}

variable "github_repo" {
  type    = string
  default = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}
