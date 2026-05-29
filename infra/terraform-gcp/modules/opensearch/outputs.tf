output "endpoint_secret_name" {
  value = var.endpoint == "" ? null : google_secret_manager_secret.endpoint[0].name
}
