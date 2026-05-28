output "dr_bucket_name" { value = aws_s3_bucket.dr.bucket }
output "dr_bucket_arn"  { value = aws_s3_bucket.dr.arn }
output "replication_role_arn" { value = aws_iam_role.replication.arn }
