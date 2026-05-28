output "nlb_dns_name"     { value = aws_lb.this.dns_name }
output "nlb_zone_id"      { value = aws_lb.this.zone_id }
output "service_name"     { value = aws_ecs_service.ws.name }
output "task_sg_id"       { value = aws_security_group.task.id }
output "log_group_name"   { value = aws_cloudwatch_log_group.this.name }
