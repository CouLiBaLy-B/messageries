variable "name" { type = string }
variable "alert_emails" {
  type    = list(string)
  default = []
}
