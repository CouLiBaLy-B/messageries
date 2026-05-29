output "jwt_secret_id"  { value = google_secret_manager_secret.jwt.id }
output "db_password_id" { value = google_secret_manager_secret.db.id }
output "redis_auth_id"  { value = google_secret_manager_secret.redis.id }

output "jwt_secret_name"  { value = google_secret_manager_secret.jwt.name }
output "db_password_name" { value = google_secret_manager_secret.db.name }
output "redis_auth_name"  { value = google_secret_manager_secret.redis.name }

output "db_password_value" {
  value     = random_password.db.result
  sensitive = true
}
output "redis_auth_value" {
  value     = random_password.redis_auth.result
  sensitive = true
}
