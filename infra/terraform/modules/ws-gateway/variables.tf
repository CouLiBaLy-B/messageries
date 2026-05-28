variable "name" { type = string }
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "app_subnet_ids" { type = list(string) }
variable "certificate_arn" { type = string }

variable "ecs_cluster_arn" { type = string }
variable "ecs_cluster_name" { type = string }
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
  default = 20
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "jwt_secret_arn" { type = string }
variable "redis_auth_arn" { type = string }

variable "log_retention_days" {
  type    = number
  default = 30
}
variable "logs_kms_key_arn" { type = string }
variable "deletion_protection" {
  type    = bool
  default = true
}
variable "tags" {
  type    = map(string)
  default = {}
}
