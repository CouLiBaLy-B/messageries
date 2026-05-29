output "api_sa_email" { value = google_service_account.api.email }
output "ws_sa_email" {
  value = var.create_ws_gateway_sa ? google_service_account.ws[0].email : null
}
output "deploy_sa_email" {
  value = var.create_github_deploy ? google_service_account.deploy[0].email : null
}
output "workload_identity_provider" {
  value = var.create_github_deploy ? google_iam_workload_identity_pool_provider.github[0].name : null
}
