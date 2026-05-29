variable "project_id" { type = string }
variable "dns_managed_zone_name" {
  type        = string
  description = "Nom de la managed zone Cloud DNS qui héberge le record"
}
variable "record_name" {
  type        = string
  description = "FQDN sans le point final, ex: api.example.com"
}
variable "primary_ip" {
  type        = string
  description = "IP du LB primary (sortie module/loadbalancer envs/staging|prod)"
}
variable "dr_ip" {
  type        = string
  description = "IP du LB DR (sortie module/loadbalancer envs/dr)"
}
variable "notification_channels" {
  type    = list(string)
  default = []
}
