/**
 * S3 Cross-Region Replication :
 *  - bucket destination DR (chiffré KMS DR)
 *  - rôle IAM de réplication avec policy stricte
 *  - réplication des deletes + des SSE-KMS objects
 */

resource "aws_s3_bucket" "dr" {
  bucket = var.dr_bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_ownership_controls" "dr" {
  bucket = aws_s3_bucket.dr.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_public_access_block" "dr" {
  bucket                  = aws_s3_bucket.dr.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "dr" {
  bucket = aws_s3_bucket.dr.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "dr" {
  bucket = aws_s3_bucket.dr.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.dr_kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_iam_role" "replication" {
  name     = "${var.source_bucket_name}-s3-replication"
  provider = aws.source
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "replication" {
  provider = aws.source
  role     = aws_iam_role.replication.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetReplicationConfiguration", "s3:ListBucket",
          "s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Resource = [
          var.source_bucket_arn,
          "${var.source_bucket_arn}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags"
        ]
        Resource = "${aws_s3_bucket.dr.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.source_kms_key_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:GenerateDataKey"]
        Resource = [var.dr_kms_key_arn]
      }
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "this" {
  provider = aws.source
  bucket   = var.source_bucket_name
  role     = aws_iam_role.replication.arn

  rule {
    id     = "replicate-all"
    status = "Enabled"
    filter {}
    delete_marker_replication { status = "Enabled" }

    source_selection_criteria {
      sse_kms_encrypted_objects { status = "Enabled" }
    }

    destination {
      bucket        = aws_s3_bucket.dr.arn
      storage_class = "STANDARD_IA"
      encryption_configuration {
        replica_kms_key_id = var.dr_kms_key_arn
      }
      replication_time {
        status = "Enabled"
        time   { minutes = 15 }
      }
      metrics {
        status = "Enabled"
        event_threshold { minutes = 15 }
      }
    }
  }
}
