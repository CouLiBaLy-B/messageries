variable "name" { type = string }
variable "region" { type = string }

variable "alb_arn_suffix" { type = string }
variable "ecs_cluster_name" { type = string }
variable "ecs_service_name" { type = string }
variable "rds_instance_id" { type = string }

variable "rds_connection_threshold" {
  type    = number
  default = 80
}

variable "metrics_namespace" {
  type    = string
  default = "Messaging"
}

variable "kms_key_id" {
  type    = string
  default = null
}

variable "alert_emails" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
