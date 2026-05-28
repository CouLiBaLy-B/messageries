/**
 * Composition DR (région secondaire eu-west-1) :
 *  - VPC + KMS DR
 *  - RDS read replica cross-region depuis primary_rds_arn
 *  - S3 destination + replication config sur le bucket primaire
 *  - Route 53 failover (zone hostée commune)
 *
 *  Le déploiement ECS/ALB DR utilise les modules normaux (./modules/ecs, /alb, etc.)
 *  réutilisés en région dr_region — pas réinventés ici.
 */

provider "aws" {
  alias  = "primary"
  region = var.primary_region
  default_tags { tags = { Project = "messaging", Environment = "${var.env}-primary", ManagedBy = "terraform" } }
}

provider "aws" {
  alias  = "dr"
  region = var.dr_region
  default_tags { tags = { Project = "messaging", Environment = "${var.env}-dr", ManagedBy = "terraform" } }
}

# Provider par défaut = DR (pour la majorité des resources)
provider "aws" {
  region = var.dr_region
  default_tags { tags = { Project = "messaging", Environment = "${var.env}-dr", ManagedBy = "terraform" } }
}

locals {
  name = "messaging-${var.env}"
}

# --- VPC DR (CIDR différent !) ---
module "vpc_dr" {
  source             = "../../modules/vpc"
  name               = "${local.name}-dr"
  cidr_block         = "10.40.0.0/16"
  single_nat_gateway = false
  enable_flow_logs   = true
}

# --- KMS DR (multi-region key serait idéal, ici keys séparées par simplicité) ---
module "kms_dr" {
  source = "../../modules/kms"
  name   = "${local.name}-dr"
  region = var.dr_region
}

# --- RDS DR replica ---
module "rds_dr" {
  source = "../../modules/dr-rds-replica"

  name           = local.name
  source_db_arn  = var.primary_rds_arn
  vpc_id         = module.vpc_dr.vpc_id
  vpc_cidr       = "10.40.0.0/16"
  subnet_ids     = module.vpc_dr.data_subnet_ids
  kms_key_arn    = module.kms_dr.rds_key_arn
  instance_class = "db.t4g.small"
}

# --- S3 DR + replication ---
module "s3_dr" {
  source = "../../modules/dr-s3-replication"

  providers = { aws.source = aws.primary }

  source_bucket_name = var.primary_s3_bucket_name
  source_bucket_arn  = var.primary_s3_bucket_arn
  source_kms_key_arn = var.primary_s3_kms_key_arn
  dr_bucket_name     = "${var.primary_s3_bucket_name}-dr"
  dr_kms_key_arn     = module.kms_dr.s3_key_arn
}

# --- Route 53 failover ---
module "failover" {
  source = "../../modules/dr-route53-failover"

  hosted_zone_id      = var.hosted_zone_id
  domain_name         = var.domain_name
  primary_alb_dns     = var.primary_alb_dns
  primary_alb_zone_id = var.primary_alb_zone_id
  dr_alb_dns          = var.dr_alb_dns
  dr_alb_zone_id      = var.dr_alb_zone_id
  sns_topic_arn       = var.primary_sns_topic_arn
}

output "dr_rds_endpoint"   { value = module.rds_dr.replica_endpoint }
output "dr_s3_bucket_name" { value = module.s3_dr.dr_bucket_name }
output "dr_vpc_id"         { value = module.vpc_dr.vpc_id }
