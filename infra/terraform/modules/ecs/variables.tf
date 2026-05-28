variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "alb_security_group_id" { type = string }
variable "target_group_arn" { type = string }
variable "alb_target_resource_label" { type = string }

variable "execution_role_arn" { type = string }
variable "task_role_arn" { type = string }
variable "image_uri" { type = string }

variable "task_cpu" {
  type    = number
  default = 512
}

variable "task_memory" {
  type    = number
  default = 1024
}

variable "desired_count" {
  type    = number
  default = 2
}

variable "min_capacity" {
  type    = number
  default = 2
}

variable "max_capacity" {
  type    = number
  default = 10
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "jwt_secret_arn" { type = string }
variable "db_password_arn" { type = string }
variable "redis_auth_arn" { type = string }

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "logs_kms_key_arn" { type = string }

variable "tracing_enabled" {
  type    = bool
  default = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
