output "alb_dns_name"          { value = module.alb.alb_dns_name }
output "alb_zone_id"           { value = module.alb.alb_zone_id }
output "ecr_repository_url"    { value = module.ecr.repository_url }
output "ecs_cluster_name"      { value = module.ecs.cluster_name }
output "ecs_service_name"      { value = module.ecs.service_name }
output "s3_bucket_name"        { value = module.s3.bucket_name }
output "github_deploy_role_arn" { value = module.iam.github_deploy_role_arn }
