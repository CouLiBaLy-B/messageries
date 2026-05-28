/**
 * Cross-region read replica RDS PostgreSQL.
 *
 * - source_db_instance_identifier = ARN du primaire (provider primaire)
 *  - kms_key_id : KMS clé DR (différente de la primary, créée dans la région DR)
 *  - storage encrypted
 *  - Promote en cas de DR : `aws rds promote-read-replica` ou Terraform replace
 */

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-dr-pg"
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "this" {
  name        = "${var.name}-dr-pg-sg"
  description = "DR Postgres ingress from app DR SG (post-failover)"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr] # ouvert au VPC DR (sera utilisé après promote)
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}

resource "aws_db_instance" "replica" {
  identifier                          = "${var.name}-dr-pg"
  replicate_source_db                 = var.source_db_arn # cross-region → ARN complet
  instance_class                      = var.instance_class
  storage_encrypted                   = true
  kms_key_id                          = var.kms_key_arn
  vpc_security_group_ids              = [aws_security_group.this.id]
  db_subnet_group_name                = aws_db_subnet_group.this.name
  publicly_accessible                 = false
  auto_minor_version_upgrade          = true
  backup_retention_period             = 7
  copy_tags_to_snapshot               = true
  deletion_protection                 = true
  performance_insights_enabled        = true
  performance_insights_kms_key_id     = var.kms_key_arn
  enabled_cloudwatch_logs_exports     = ["postgresql"]
  iam_database_authentication_enabled = false
  skip_final_snapshot                 = false
  final_snapshot_identifier           = "${var.name}-dr-pg-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  tags                                = var.tags

  lifecycle {
    ignore_changes = [final_snapshot_identifier, replicate_source_db]
  }
}
