variable "name" { type = string }
variable "region" { type = string }
variable "kms_key_id" {
  type    = string
  default = ""
  description = "CryptoKey ID pour CMEK (vide = chiffrement Google géré)"
}
