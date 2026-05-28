output "cluster_name"   { value = aws_ecs_cluster.this.name }
output "service_name"   { value = aws_ecs_service.app.name }
output "task_role_arn"  { value = var.task_role_arn }
output "task_sg_id"     { value = aws_security_group.task.id }
output "log_group_name" { value = aws_cloudwatch_log_group.this.name }
