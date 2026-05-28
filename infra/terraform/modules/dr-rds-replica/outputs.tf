output "replica_arn"      { value = aws_db_instance.replica.arn }
output "replica_endpoint" { value = aws_db_instance.replica.address }
output "replica_id"       { value = aws_db_instance.replica.identifier }
output "security_group_id" { value = aws_security_group.this.id }
