variable "primary_region" {
  type    = string
  default = "eu-west-3"
}
variable "dr_region" {
  type    = string
  default = "eu-west-1"
}
variable "env" {
  type    = string
  default = "prod"
}

# Outputs de la stack primary (à récupérer manuellement ou via remote_state)
variable "primary_rds_arn" { type = string }
variable "primary_s3_bucket_name" { type = string }
variable "primary_s3_bucket_arn" { type = string }
variable "primary_s3_kms_key_arn" { type = string }
variable "primary_alb_dns" { type = string }
variable "primary_alb_zone_id" { type = string }
variable "primary_sns_topic_arn" { type = string }

# DR-side
variable "dr_alb_dns" { type = string }
variable "dr_alb_zone_id" { type = string }

variable "hosted_zone_id" { type = string }
variable "domain_name" { type = string }
