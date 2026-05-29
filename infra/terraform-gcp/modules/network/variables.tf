variable "name" { type = string }
variable "region" { type = string }
variable "app_cidr" {
  type    = string
  default = "10.20.0.0/20"
}
variable "connector_cidr" {
  type    = string
  default = "10.20.16.0/28"
}
