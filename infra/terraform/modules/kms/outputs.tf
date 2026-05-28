output "rds_key_arn"  { value = aws_kms_key.rds.arn }
output "s3_key_arn"   { value = aws_kms_key.s3.arn }
output "app_key_arn"  { value = aws_kms_key.app.arn }
output "logs_key_arn" { value = aws_kms_key.logs.arn }
output "app_key_id"   { value = aws_kms_key.app.key_id }
