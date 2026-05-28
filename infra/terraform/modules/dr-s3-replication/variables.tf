variable "source_bucket_name" { type = string }
variable "source_bucket_arn" { type = string }
variable "source_kms_key_arn" { type = string }

variable "dr_bucket_name" { type = string }
variable "dr_kms_key_arn" { type = string }

variable "tags" {
  type    = map(string)
  default = {}
}
