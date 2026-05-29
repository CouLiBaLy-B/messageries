output "lb_ip"            { value = module.lb.ip_address }
output "api_service_uri"  { value = module.api.service_uri }
output "ws_service_uri"   { value = var.enable_ws_gateway ? module.ws_gateway[0].service_uri : null }
output "artifact_registry_url" { value = module.ar.repository_url }
output "gcs_bucket_name"  { value = module.gcs.bucket_name }
output "cloudsql_instance" { value = module.sql.instance_name }
output "cloudsql_connection_name" { value = module.sql.connection_name }
output "redis_host" {
  value     = module.redis.host
  sensitive = true
}
output "deploy_sa_email" { value = module.iam.deploy_sa_email }
output "workload_identity_provider" { value = module.iam.workload_identity_provider }
output "app_kms_key_name" { value = module.kms.app_key_id }
output "nats_cluster" {
  value = var.enable_nats ? module.nats[0].cluster_name : null
}
