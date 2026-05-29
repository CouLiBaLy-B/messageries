variable "name" { type = string }
variable "region" { type = string }
variable "project_id" { type = string }
variable "vpc_self_link" { type = string }
variable "subnet_self_link" { type = string }
variable "authorized_master_cidrs" {
  type    = list(string)
  default = []
}
