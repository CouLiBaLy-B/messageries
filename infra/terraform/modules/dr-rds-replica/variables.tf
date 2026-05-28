variable "name" { type = string }
variable "source_db_arn" {
  type        = string
  description = "ARN complet du RDS primary (cross-region)"
}
variable "vpc_id" { type = string }
variable "vpc_cidr" { type = string }
variable "subnet_ids" { type = list(string) }
variable "kms_key_arn" { type = string }
variable "instance_class" {
  type    = string
  default = "db.t4g.small"
}
variable "tags" {
  type    = map(string)
  default = {}
}
