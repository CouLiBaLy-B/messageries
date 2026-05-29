variable "name" { type = string }

variable "cloud_run_services" {
  description = "map: key → { service_name, region, host, timeout_sec }"
  type = map(object({
    service_name = string
    region       = string
    host         = string
    timeout_sec  = number
  }))
}

variable "default_backend" {
  type        = string
  description = "Clé du backend par défaut (ex: api)"
}

variable "security_policy_id" {
  type    = string
  default = null
}
