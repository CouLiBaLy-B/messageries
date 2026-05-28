/**
 * Composition prod : durcie (multi-NAT, RDS larger, deletion protection ON).
 */

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "messaging"
      Environment = var.env
      ManagedBy   = "terraform"
    }
  }
}

locals {
  name = "messaging-${var.env}"
  tags = {
    Project     = "messaging"
    Environment = var.env
  }
}

data "aws_caller_identity" "current" {}

module "kms" {
  source = "../../modules/kms"
  name   = local.name
  region = var.region
  tags   = local.tags
}

module "secrets" {
  source     = "../../modules/secrets"
  name       = local.name
  kms_key_id = module.kms.app_key_arn
  tags       = local.tags
}

module "vpc" {
  source             = "../../modules/vpc"
  name               = local.name
  cidr_block         = "10.30.0.0/16"
  single_nat_gateway = false
  enable_flow_logs   = true
  logs_kms_key_arn   = module.kms.logs_key_arn
  tags               = local.tags
}

module "s3" {
  source          = "../../modules/s3"
  name            = local.name
  kms_key_arn     = module.kms.s3_key_arn
  allowed_origins = var.allowed_origins
  tags            = local.tags
}

module "ecr" {
  source      = "../../modules/ecr"
  name        = local.name
  kms_key_arn = module.kms.app_key_arn
  tags        = local.tags
}

module "iam" {
  source              = "../../modules/iam"
  name                = local.name
  s3_bucket_arn       = module.s3.bucket_arn
  app_kms_key_arn     = module.kms.app_key_arn
  s3_kms_key_arn      = module.kms.s3_key_arn
  kms_secrets_key_arn = module.kms.app_key_arn
  secret_arns = [
    module.secrets.jwt_secret_arn,
    module.secrets.db_password_arn,
    module.secrets.redis_auth_arn,
  ]
  create_github_deploy_role = var.github_repo != ""
  github_repo               = var.github_repo
  tags                      = local.tags
}

module "alb" {
  source              = "../../modules/alb"
  name                = local.name
  vpc_id              = module.vpc.vpc_id
  public_subnet_ids   = module.vpc.public_subnet_ids
  certificate_arn     = var.certificate_arn
  deletion_protection = true
  tags                = local.tags
}

module "rds" {
  source                     = "../../modules/rds"
  name                       = local.name
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.data_subnet_ids
  allowed_security_group_ids = []
  master_password            = module.secrets.db_password_value
  kms_key_arn                = module.kms.rds_key_arn
  instance_class             = "db.m6g.large"
  allocated_storage_gb       = 100
  max_allocated_storage_gb   = 1000
  multi_az                   = true
  backup_retention_days      = 30
  deletion_protection        = true
  tags                       = local.tags
}

resource "aws_cloudwatch_log_group" "redis" {
  name              = "/aws/elasticache/${local.name}/slowlog"
  retention_in_days = 90
  kms_key_id        = module.kms.logs_key_arn
  tags              = local.tags
}

module "redis" {
  source                     = "../../modules/redis"
  name                       = local.name
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.data_subnet_ids
  allowed_security_group_ids = []
  auth_token                 = module.secrets.redis_auth_value
  node_type                  = "cache.m7g.large"
  num_cache_clusters         = 3
  log_group_name             = aws_cloudwatch_log_group.redis.name
  tags                       = local.tags
}

module "ecs" {
  source = "../../modules/ecs"
  name   = local.name
  vpc_id = module.vpc.vpc_id

  subnet_ids                = module.vpc.app_subnet_ids
  alb_security_group_id     = module.alb.alb_security_group_id
  target_group_arn          = module.alb.target_group_arn
  alb_target_resource_label = "${replace(module.alb.alb_arn, "arn:aws:elasticloadbalancing:${var.region}:${data.aws_caller_identity.current.account_id}:loadbalancer/", "")}/${replace(module.alb.target_group_arn, "arn:aws:elasticloadbalancing:${var.region}:${data.aws_caller_identity.current.account_id}:targetgroup/", "")}"

  execution_role_arn = module.iam.execution_role_arn
  task_role_arn      = module.iam.task_role_arn
  image_uri          = "${module.ecr.repository_url}:${var.image_tag}"

  task_cpu      = 1024
  task_memory   = 2048
  desired_count = 3
  min_capacity  = 3
  max_capacity  = 20

  environment = {
    NODE_ENV              = var.env
    PORT                  = "3000"
    API_PREFIX            = "api/v1"
    APP_URL               = "https://${var.domain_name}"
    ALLOWED_ORIGINS       = join(",", var.allowed_origins)
    DB_HOST               = module.rds.endpoint
    DB_PORT               = tostring(module.rds.port)
    DB_USERNAME           = module.rds.username
    DB_NAME               = module.rds.db_name
    DB_SSL                = "true"
    REDIS_HOST            = module.redis.primary_endpoint
    REDIS_PORT            = tostring(module.redis.port)
    REDIS_TLS             = "true"
    S3_ENDPOINT           = "https://s3.${var.region}.amazonaws.com"
    S3_REGION             = var.region
    S3_BUCKET             = module.s3.bucket_name
    S3_FORCE_PATH_STYLE   = "false"
    S3_USE_IAM_ROLE       = "true"
    KMS_DRIVER            = "aws"
    AWS_KMS_KEY_ARN       = module.kms.app_key_arn
    ENCRYPT_MESSAGE_BODY  = "true"
    OUTBOX_WORKER_ENABLED = "true"
    METRICS_NAMESPACE     = "Messaging"
    METRICS_ENABLED       = "true"
    AWS_REGION            = var.region
  }

  jwt_secret_arn  = module.secrets.jwt_secret_arn
  db_password_arn = module.secrets.db_password_arn
  redis_auth_arn  = module.secrets.redis_auth_arn

  log_retention_days = 90
  tracing_enabled    = var.tracing_enabled
  logs_kms_key_arn   = module.kms.logs_key_arn
  tags               = local.tags
}

resource "aws_security_group_rule" "rds_from_ecs" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = module.ecs.task_sg_id
  security_group_id        = module.rds.security_group_id
}

resource "aws_security_group_rule" "redis_from_ecs" {
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = module.ecs.task_sg_id
  security_group_id        = module.redis.security_group_id
}

module "waf" {
  source              = "../../modules/waf"
  name                = local.name
  alb_arn             = module.alb.alb_arn
  rate_limit_per_5min = 5000
  tags                = local.tags
}

module "observability" {
  source = "../../modules/observability"
  name   = local.name
  region = var.region

  alb_arn_suffix   = element(split("loadbalancer/", module.alb.alb_arn), 1)
  ecs_cluster_name = module.ecs.cluster_name
  ecs_service_name = module.ecs.service_name
  rds_instance_id  = "${local.name}-pg"

  rds_connection_threshold = 200
  metrics_namespace        = "Messaging"
  kms_key_id               = module.kms.app_key_arn
  alert_emails             = var.alert_emails
  tags                     = local.tags
}
