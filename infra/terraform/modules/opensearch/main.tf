/**
 * Amazon OpenSearch Service domain :
 *  - VPC privé (subnets data), pas d'IP publique
 *  - chiffré au repos KMS + node-to-node + HTTPS only
 *  - master user (rotation manuelle, secret généré)
 *  - 2 data nodes Multi-AZ (ou 1 single-AZ staging)
 *  - logs slow_log + audit_log → CloudWatch
 *  - SG ingress 443 depuis SG api uniquement
 */

resource "random_password" "master" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "master" {
  name                    = "${var.name}/opensearch-master"
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = 7
  tags                    = var.tags
}
resource "aws_secretsmanager_secret_version" "master" {
  secret_id     = aws_secretsmanager_secret.master.id
  secret_string = jsonencode({ username = "messaging_admin", password = random_password.master.result })
}

resource "aws_security_group" "this" {
  name        = "${var.name}-os-sg"
  description = "OpenSearch ingress from app SG only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = var.allowed_security_group_ids
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}

resource "aws_cloudwatch_log_group" "audit" {
  name              = "/aws/opensearch/${var.name}/audit"
  retention_in_days = 90
  kms_key_id        = var.logs_kms_key_arn
  tags              = var.tags
}
resource "aws_cloudwatch_log_group" "slow" {
  name              = "/aws/opensearch/${var.name}/slow"
  retention_in_days = 30
  kms_key_id        = var.logs_kms_key_arn
  tags              = var.tags
}

resource "aws_cloudwatch_log_resource_policy" "this" {
  policy_name = "${var.name}-os-logs"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "es.amazonaws.com" }
      Action    = ["logs:PutLogEvents", "logs:CreateLogStream"]
      Resource  = "arn:aws:logs:*"
    }]
  })
}

resource "aws_opensearch_domain" "this" {
  domain_name    = "${var.name}-os"
  engine_version = "OpenSearch_2.13"

  cluster_config {
    instance_type            = var.instance_type
    instance_count           = var.instance_count
    zone_awareness_enabled   = var.instance_count > 1
    dynamic "zone_awareness_config" {
      for_each = var.instance_count > 1 ? [1] : []
      content { availability_zone_count = min(var.instance_count, 3) }
    }
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = var.volume_size_gb
  }

  encrypt_at_rest {
    enabled    = true
    kms_key_id = var.kms_key_arn
  }
  node_to_node_encryption { enabled = true }
  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-PFS-2023-10"
  }

  vpc_options {
    subnet_ids         = slice(var.subnet_ids, 0, min(var.instance_count, length(var.subnet_ids)))
    security_group_ids = [aws_security_group.this.id]
  }

  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = true
    master_user_options {
      master_user_name     = "messaging_admin"
      master_user_password = random_password.master.result
    }
  }

  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.audit.arn
    log_type                 = "AUDIT_LOGS"
  }
  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.slow.arn
    log_type                 = "SEARCH_SLOW_LOGS"
  }

  access_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = "*" }
      Action    = "es:*"
      Resource  = "arn:aws:es:*:*:domain/${var.name}-os/*"
    }]
  })

  tags = var.tags

  depends_on = [aws_cloudwatch_log_resource_policy.this]
}
