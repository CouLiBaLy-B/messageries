/**
 * 3 CMK séparées : isolation des blast radius.
 *  - rds  : EBS RDS au repos
 *  - s3   : objets S3 attachments
 *  - app  : KEK pour envelope encryption applicative (DEK wrap)
 *           → utilisée par l'app via kms:GenerateDataKey / kms:Decrypt
 */

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "rds" {
  description             = "${var.name} RDS encryption"
  deletion_window_in_days = 14
  enable_key_rotation     = true
  tags                    = merge(var.tags, { Purpose = "rds" })
}

resource "aws_kms_alias" "rds" {
  name          = "alias/${var.name}-rds"
  target_key_id = aws_kms_key.rds.key_id
}

resource "aws_kms_key" "s3" {
  description             = "${var.name} S3 attachments encryption"
  deletion_window_in_days = 14
  enable_key_rotation     = true
  tags                    = merge(var.tags, { Purpose = "s3" })
}

resource "aws_kms_alias" "s3" {
  name          = "alias/${var.name}-s3"
  target_key_id = aws_kms_key.s3.key_id
}

resource "aws_kms_key" "app" {
  description             = "${var.name} App envelope KEK (DEK wrap)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "RootAdmin"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      }
    ]
  })
  tags = merge(var.tags, { Purpose = "app-envelope" })
}

resource "aws_kms_alias" "app" {
  name          = "alias/${var.name}-app"
  target_key_id = aws_kms_key.app.key_id
}

resource "aws_kms_key" "logs" {
  description             = "${var.name} CloudWatch logs encryption"
  deletion_window_in_days = 14
  enable_key_rotation     = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "RootAdmin"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid    = "AllowCloudWatchLogs"
        Effect = "Allow"
        Principal = { Service = "logs.${var.region}.amazonaws.com" }
        Action = [
          "kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*",
          "kms:GenerateDataKey*", "kms:Describe*"
        ]
        Resource = "*"
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:*"
          }
        }
      }
    ]
  })
  tags = merge(var.tags, { Purpose = "logs" })
}

resource "aws_kms_alias" "logs" {
  name          = "alias/${var.name}-logs"
  target_key_id = aws_kms_key.logs.key_id
}
