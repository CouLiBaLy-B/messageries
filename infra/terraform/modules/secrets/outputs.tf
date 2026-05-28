output "jwt_secret_arn"  { value = aws_secretsmanager_secret.jwt.arn }
output "db_password_arn" { value = aws_secretsmanager_secret.db.arn }
output "redis_auth_arn"  { value = aws_secretsmanager_secret.redis.arn }

output "db_password_value" {
  value     = random_password.db.result
  sensitive = true
}

output "redis_auth_value" {
  value     = random_password.redis_auth.result
  sensitive = true
}
