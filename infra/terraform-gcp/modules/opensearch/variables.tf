variable "name" { type = string }
variable "endpoint" {
  type    = string
  default = ""
  description = "Endpoint Elastic Cloud (https://...) — créer manuellement via Elastic console"
}
