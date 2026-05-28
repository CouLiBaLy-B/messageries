/**
 * Composition staging.
 * Pattern : KMS → Secrets → Network → DataStores → ECR → ALB → ECS → WAF → Observability
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

# --- KMS ---
module "kms" {
  source = "../../modules/kms"
  name   = local.name
  region = var.region
  tags   = local.tags
}

# --- Secrets ---
module "secrets" {
  source     = "../../modules/secrets"
  name       = local.name
  kms_key_id = module.kms.app_key_arn
  tags       = local.tags
}

# --- VPC ---
module "vpc" {
  source             = "../../modules/vpc"
  name               = local.name
  cidr_block         = "10.20.0.0/16"
  single_nat_gateway = true # staging : économie
  enable_flow_logs   = true
  logs_kms_key_arn   = module.kms.logs_key_arn
  tags               = local.tags
}

# --- S3 attachments ---
module "s3" {
  source          = "../../modules/s3"
  name            = local.name
  kms_key_arn     = module.kms.s3_key_arn
  allowed_origins = var.allowed_origins
  tags            = local.tags
}

# --- ECR ---
module "ecr" {
  source      = "../../modules/ecr"
  name        = local.name
  kms_key_arn = module.kms.app_key_arn # ou key dédiée si tu veux
  tags        = local.tags
}

# --- IAM (rôles ECS + deploy GitHub) ---
module "iam" {
  source                    = "../../modules/iam"
  name                      = local.name
  s3_bucket_arn             = module.s3.bucket_arn
  app_kms_key_arn           = module.kms.app_key_arn
  s3_kms_key_arn            = module.kms.s3_key_arn
  kms_secrets_key_arn       = module.kms.app_key_arn
  secret_arns = [
    module.secrets.jwt_secret_arn,
    module.secrets.db_password_arn,
    module.secrets.redis_auth_arn,
  ]
  create_github_deploy_role = var.github_repo != ""
  github_repo               = var.github_repo
  tags                      = local.tags
}

# --- ALB ---
module "alb" {
  source              = "../../modules/alb"
  name                = local.name
  vpc_id              = module.vpc.vpc_id
  public_subnet_ids   = module.vpc.public_subnet_ids
  certificate_arn     = var.certificate_arn
  deletion_protection = false # staging
  tags                = local.tags
}

# --- RDS ---
module "rds" {
  source                     = "../../modules/rds"
  name                       = local.name
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.data_subnet_ids
  allowed_security_group_ids = [] # sera attaché plus bas via SG ECS task
  master_password            = module.secrets.db_password_value
  kms_key_arn                = module.kms.rds_key_arn
  instance_class             = "db.t4g.small"
  multi_az                   = true
  backup_retention_days      = 14
  deletion_protection        = false # staging
  tags                       = local.tags
  # ⚠️ note : pour staging on autorise la suppression. Prod = true.
}

# --- Log group Redis ---
resource "aws_cloudwatch_log_group" "redis" {
  name              = "/aws/elasticache/${local.name}/slowlog"
  retention_in_days = 14
  kms_key_id        = module.kms.logs_key_arn
  tags              = local.tags
}

# --- Redis ---
module "redis" {
  source                     = "../../modules/redis"
  name                       = local.name
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.data_subnet_ids
  allowed_security_group_ids = [] # idem, branché plus bas
  auth_token                 = module.secrets.redis_auth_value
  node_type                  = "cache.t4g.small"
  num_cache_clusters         = 2
  log_group_name             = aws_cloudwatch_log_group.redis.name
  tags                       = local.tags
}

# --- ECS ---
module "ecs" {
  source = "../../modules/ecs"
  name   = local.name
  vpc_id = module.vpc.vpc_id
  subnet_ids            = module.vpc.app_subnet_ids
  alb_security_group_id = module.alb.alb_security_group_id
  target_group_arn      = module.alb.target_group_arn
  alb_target_resource_label = "${replace(module.alb.alb_arn, "arn:aws:elasticloadbalancing:${var.region}:${data.aws_caller_identity.current.account_id}:loadbalancer/", "")}/${replace(module.alb.target_group_arn, "arn:aws:elasticloadbalancing:${var.region}:${data.aws_caller_identity.current.account_id}:targetgroup/", "")}"

  execution_role_arn = module.iam.execution_role_arn
  task_role_arn      = module.iam.task_role_arn
  image_uri          = "${module.ecr.repository_url}:${var.image_tag}"

  task_cpu      = 512
  task_memory   = 1024
  desired_count = 2
  min_capacity  = 2
  max_capacity  = 6

  environment = {
    NODE_ENV               = var.env
    PORT                   = "3000"
    API_PREFIX             = "api/v1"
    APP_URL                = "https://${var.domain_name}"
    ALLOWED_ORIGINS        = join(",", var.allowed_origins)
    DB_HOST                = module.rds.endpoint
    DB_PORT                = tostring(module.rds.port)
    DB_USERNAME            = module.rds.username
    DB_NAME                = module.rds.db_name
    DB_SSL                 = "true"
    REDIS_HOST             = module.redis.primary_endpoint
    REDIS_PORT             = tostring(module.redis.port)
    REDIS_TLS              = "true"
    S3_ENDPOINT            = "https://s3.${var.region}.amazonaws.com"
    S3_REGION              = var.region
    S3_BUCKET              = module.s3.bucket_name
    S3_FORCE_PATH_STYLE    = "false"
    # ⚠️ S3 access key/secret = on bascule sur IAM role (sdk auto)
    S3_USE_IAM_ROLE        = "true"
    KMS_DRIVER             = "aws"
    AWS_KMS_KEY_ARN        = module.kms.app_key_arn
    ENCRYPT_MESSAGE_BODY   = "true"
    OUTBOX_WORKER_ENABLED  = "true"
    METRICS_NAMESPACE      = "Messaging"
    METRICS_ENABLED        = "true"
    AWS_REGION             = var.region
    NATS_ENABLED           = var.enable_phase5 ? "true" : "false"
    NATS_URL               = var.enable_phase5 ? "nats://nats.${local.name}.internal:4222" : ""
    NATS_STREAM            = "MESSAGING_EVENTS"
    WS_GATEWAY_DEDICATED   = var.enable_phase5 ? "true" : "false"
  }

  jwt_secret_arn  = module.secrets.jwt_secret_arn
  db_password_arn = module.secrets.db_password_arn
  redis_auth_arn  = module.secrets.redis_auth_arn

  log_retention_days = 30
  tracing_enabled    = var.tracing_enabled
  logs_kms_key_arn   = module.kms.logs_key_arn
  tags               = local.tags
}

# --- Ouverture des SG data vers le SG ECS task ---
resource "aws_security_group_rule" "rds_from_ecs" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = module.ecs.task_sg_id
  security_group_id        = module.rds.security_group_id
  description              = "Postgres from ECS tasks"
}

resource "aws_security_group_rule" "redis_from_ecs" {
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = module.ecs.task_sg_id
  security_group_id        = module.redis.security_group_id
  description              = "Redis from ECS tasks"
}

# --- WAF ---
module "waf" {
  source              = "../../modules/waf"
  name                = local.name
  alb_arn             = module.alb.alb_arn
  rate_limit_per_5min = 2000
  tags                = local.tags
}

# --- Observability ---
module "observability" {
  source = "../../modules/observability"
  name   = local.name
  region = var.region

  alb_arn_suffix   = element(split("loadbalancer/", module.alb.alb_arn), 1)
  ecs_cluster_name = module.ecs.cluster_name
  ecs_service_name = module.ecs.service_name
  rds_instance_id  = "${local.name}-pg"

  metrics_namespace = "Messaging"
  kms_key_id        = module.kms.app_key_arn
  alert_emails      = var.alert_emails
  tags              = local.tags
}

# ============================================================
# Phase 5 (opt-in) : NATS JetStream + WS Gateway dédié
# Activer avec: terraform apply -var='enable_phase5=true'
# ============================================================

module "nats" {
  count  = var.enable_phase5 ? 1 : 0
  source = "../../modules/nats"

  name                       = local.name
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.app_subnet_ids
  allowed_security_group_ids = compact([
    module.ecs.task_sg_id,
    # le SG du ws-gateway sera ajouté par règle séparée pour éviter le cycle
  ])
  kms_key_arn       = module.kms.app_key_arn
  logs_kms_key_arn  = module.kms.logs_key_arn
  replicas          = 3
  cpu               = 512
  memory            = 1024
  tags              = local.tags
}

# ECR séparé pour l'image ws-gateway
resource "aws_ecr_repository" "ws_gateway" {
  count                = var.enable_phase5 ? 1 : 0
  name                 = "${local.name}-ws"
  image_tag_mutability = "IMMUTABLE"
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = module.kms.app_key_arn
  }
  image_scanning_configuration { scan_on_push = true }
  tags = local.tags
}

module "ws_gateway" {
  count  = var.enable_phase5 ? 1 : 0
  source = "../../modules/ws-gateway"

  name              = "${local.name}-ws"
  vpc_id            = module.vpc.vpc_id
  vpc_cidr          = "10.20.0.0/16"
  public_subnet_ids = module.vpc.public_subnet_ids
  app_subnet_ids    = module.vpc.app_subnet_ids
  certificate_arn   = var.certificate_arn

  ecs_cluster_arn  = "arn:aws:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:cluster/${module.ecs.cluster_name}"
  ecs_cluster_name = module.ecs.cluster_name

  execution_role_arn = module.iam.execution_role_arn
  task_role_arn      = module.iam.task_role_arn
  image_uri          = "${aws_ecr_repository.ws_gateway[0].repository_url}:${var.ws_image_tag}"

  task_cpu      = 512
  task_memory   = 1024
  desired_count = 2
  min_capacity  = 2
  max_capacity  = 10

  environment = {
    PORT             = "3001"
    ALLOWED_ORIGINS  = join(",", var.allowed_origins)
    REDIS_HOST       = module.redis.primary_endpoint
    REDIS_PORT       = tostring(module.redis.port)
    REDIS_TLS        = "true"
    NATS_URL         = module.nats[0].url
    NATS_STREAM      = "MESSAGING_EVENTS"
    NATS_DURABLE     = "ws-gateway"
    LOG_LEVEL        = "info"
  }

  jwt_secret_arn = module.secrets.jwt_secret_arn
  redis_auth_arn = module.secrets.redis_auth_arn

  log_retention_days  = 30
  logs_kms_key_arn    = module.kms.logs_key_arn
  deletion_protection = false
  tags                = local.tags
}

# Autorise le ws-gateway à parler à NATS
resource "aws_security_group_rule" "nats_from_ws" {
  count                    = var.enable_phase5 ? 1 : 0
  type                     = "ingress"
  from_port                = 4222
  to_port                  = 4222
  protocol                 = "tcp"
  source_security_group_id = module.ws_gateway[0].task_sg_id
  security_group_id        = module.nats[0].security_group_id
}

# Autorise le ws-gateway à parler à Redis
resource "aws_security_group_rule" "redis_from_ws" {
  count                    = var.enable_phase5 ? 1 : 0
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  source_security_group_id = module.ws_gateway[0].task_sg_id
  security_group_id        = module.redis.security_group_id
}

# Autorise l'API à parler à NATS
resource "aws_security_group_rule" "nats_from_api" {
  count                    = var.enable_phase5 ? 1 : 0
  type                     = "ingress"
  from_port                = 4222
  to_port                  = 4222
  protocol                 = "tcp"
  source_security_group_id = module.ecs.task_sg_id
  security_group_id        = module.nats[0].security_group_id
}

# ============================================================
# Phase 6 (opt-in) : OpenSearch
# ============================================================
module "opensearch" {
  count  = var.enable_phase6 ? 1 : 0
  source = "../../modules/opensearch"

  name                       = local.name
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.data_subnet_ids
  allowed_security_group_ids = compact([module.ecs.task_sg_id])
  kms_key_arn                = module.kms.rds_key_arn
  logs_kms_key_arn           = module.kms.logs_key_arn
  instance_type              = "t3.small.search"
  instance_count             = 2
  tags                       = local.tags
}
