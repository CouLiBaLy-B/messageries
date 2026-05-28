variable "hosted_zone_id" { type = string }
variable "domain_name" { type = string }

variable "primary_alb_dns" { type = string }
variable "primary_alb_zone_id" { type = string }
variable "dr_alb_dns" { type = string }
variable "dr_alb_zone_id" { type = string }

variable "sns_topic_arn" { type = string }
variable "tags" {
  type    = map(string)
  default = {}
}
