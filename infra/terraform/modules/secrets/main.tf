/**
 * Secrets Manager : génération aléatoire à la création.
 * Rotation manuelle/automatisée à brancher en Phase 4.
 *
 * On ne stocke PAS les clés ici en valeur directe — Terraform persiste
 * la valeur dans le state, donc state chiffré + accès restreint impératif.
 */

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "random_password" "redis_auth" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "jwt" {
  name        = "${var.name}/jwt-secret"
  description = "JWT signing secret"
  kms_key_id  = var.kms_key_id
  tags        = var.tags
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}

resource "aws_secretsmanager_secret" "db" {
  name                    = "${var.name}/db-password"
  kms_key_id              = var.kms_key_id
  recovery_window_in_days = 7
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id     = aws_secretsmanager_secret.db.id
  secret_string = random_password.db.result
}

resource "aws_secretsmanager_secret" "redis" {
  name                    = "${var.name}/redis-auth-token"
  kms_key_id              = var.kms_key_id
  recovery_window_in_days = 7
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "redis" {
  secret_id     = aws_secretsmanager_secret.redis.id
  secret_string = random_password.redis_auth.result
}
