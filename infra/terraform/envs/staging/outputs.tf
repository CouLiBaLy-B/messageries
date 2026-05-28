output "alb_dns_name"         { value = module.alb.alb_dns_name }
output "alb_zone_id"          { value = module.alb.alb_zone_id }
output "ecr_repository_url"   { value = module.ecr.repository_url }
output "ecs_cluster_name"     { value = module.ecs.cluster_name }
output "ecs_service_name"     { value = module.ecs.service_name }
output "s3_bucket_name"       { value = module.s3.bucket_name }
output "cloudwatch_log_group" { value = module.ecs.log_group_name }
output "sns_alerts_topic_arn" { value = module.observability.sns_topic_arn }
output "app_kms_key_arn"      { value = module.kms.app_key_arn }

output "rds_endpoint" {
  value     = module.rds.endpoint
  sensitive = true
}

output "redis_endpoint" {
  value     = module.redis.primary_endpoint
  sensitive = true
}

output "github_deploy_role_arn" {
  value = module.iam.github_deploy_role_arn
}

output "nats_url" {
  value     = var.enable_phase5 ? module.nats[0].url : null
}
output "ws_nlb_dns_name" {
  value     = var.enable_phase5 ? module.ws_gateway[0].nlb_dns_name : null
}
output "ws_ecr_repository_url" {
  value     = var.enable_phase5 ? aws_ecr_repository.ws_gateway[0].repository_url : null
}
