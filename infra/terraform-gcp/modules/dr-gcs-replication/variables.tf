variable "source_project_id" { type = string }
variable "source_bucket_name" { type = string }

variable "dr_project_id" { type = string }
variable "dr_region" { type = string }
variable "dr_bucket_name" { type = string }
variable "dr_kms_key_id" {
  type    = string
  default = ""
}

variable "schedule_interval_minutes" {
  type        = number
  default     = 60
  description = "Fréquence du transfer job (minimum 60 min côté STS)"
}
