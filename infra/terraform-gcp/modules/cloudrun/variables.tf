variable "name" { type = string }
variable "region" { type = string }
variable "service_account_email" { type = string }
variable "image_uri" { type = string }

variable "container_port" {
  type    = number
  default = 3000
}
variable "health_path" {
  type    = string
  default = "/api/v1/health"
}

variable "cpu" {
  type    = string
  default = "1"
}
variable "memory" {
  type    = string
  default = "1Gi"
}
variable "min_instances" {
  type    = number
  default = 1
}
variable "max_instances" {
  type    = number
  default = 10
}
variable "concurrency" {
  type    = number
  default = 80
}
variable "timeout_seconds" {
  type    = number
  default = 300
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "secret_env" {
  type = map(object({
    secret_id = string
  }))
  default = {}
}

variable "vpc_connector" { type = string }
