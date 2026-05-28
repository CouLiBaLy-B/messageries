variable "name" { type = string }
variable "region" { type = string }

variable "tags" {
  type    = map(string)
  default = {}
}
