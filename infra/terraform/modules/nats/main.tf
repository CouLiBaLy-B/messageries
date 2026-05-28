/**
 * NATS JetStream sur ECS Fargate (3 replicas).
 *
 * Persistance : EFS monté sur /data (chiffré KMS).
 * Service discovery : Cloud Map (route 53 namespace privé) →
 *   nats-0.<ns>, nats-1.<ns>, nats-2.<ns> + alias nats.<ns>.
 * Sécurité : SG ingress 4222 depuis SG api + SG ws-gateway uniquement.
 *
 * ⚠️ Alternative production : Amazon MSK (Kafka) ou un opérateur NATS managé.
 * Ce module reste simple/portable pour démarrer.
 */

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# --- EFS pour JetStream storage ---
resource "aws_efs_file_system" "nats" {
  creation_token   = "${var.name}-nats"
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"
  encrypted        = true
  kms_key_id       = var.kms_key_arn

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }
  tags = var.tags
}

resource "aws_security_group" "efs" {
  name        = "${var.name}-nats-efs-sg"
  description = "EFS for NATS"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.nats.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}

resource "aws_efs_mount_target" "nats" {
  count           = length(var.subnet_ids)
  file_system_id  = aws_efs_file_system.nats.id
  subnet_id       = var.subnet_ids[count.index]
  security_groups = [aws_security_group.efs.id]
}

resource "aws_efs_access_point" "nats" {
  count          = var.replicas
  file_system_id = aws_efs_file_system.nats.id
  posix_user {
    uid = 1000
    gid = 1000
  }
  root_directory {
    path = "/nats-${count.index}"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "0755"
    }
  }
  tags = var.tags
}

# --- Service discovery (Cloud Map) ---
resource "aws_service_discovery_private_dns_namespace" "this" {
  name        = "${var.name}.internal"
  description = "Private namespace for ${var.name}"
  vpc         = var.vpc_id
  tags        = var.tags
}

resource "aws_service_discovery_service" "nats" {
  count = var.replicas
  name  = "nats-${count.index}"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.this.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }
  health_check_custom_config { failure_threshold = 1 }
  tags = var.tags
}

# Service alias "nats" → tous les pods
resource "aws_service_discovery_service" "nats_alias" {
  name = "nats"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.this.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }
  health_check_custom_config { failure_threshold = 1 }
  tags = var.tags
}

# --- SG NATS ---
resource "aws_security_group" "nats" {
  name        = "${var.name}-nats-sg"
  description = "NATS cluster (4222 client, 6222 routes)"
  vpc_id      = var.vpc_id

  ingress {
    description     = "NATS client from app SGs"
    from_port       = 4222
    to_port         = 4222
    protocol        = "tcp"
    security_groups = var.allowed_security_group_ids
  }

  ingress {
    description = "NATS cluster routes (self)"
    from_port   = 6222
    to_port     = 6222
    protocol    = "tcp"
    self        = true
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}

# --- IAM roles ECS tasks ---
resource "aws_iam_role" "execution" {
  name = "${var.name}-nats-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = var.tags
}
resource "aws_iam_role_policy_attachment" "exec_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task" {
  name = "${var.name}-nats-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = var.tags
}

# --- Log group ---
resource "aws_cloudwatch_log_group" "nats" {
  name              = "/ecs/${var.name}/nats"
  retention_in_days = 30
  kms_key_id        = var.logs_kms_key_arn
  tags              = var.tags
}

# --- ECS cluster ---
resource "aws_ecs_cluster" "this" {
  name = "${var.name}-nats"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = var.tags
}

# --- Task definitions (1 par replica pour avoir un EFS access point différent) ---
locals {
  routes = join(",", [for i in range(var.replicas) : "nats://nats-${i}.${var.name}.internal:6222"])
}

resource "aws_ecs_task_definition" "nats" {
  count                    = var.replicas
  family                   = "${var.name}-nats-${count.index}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  volume {
    name = "data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.nats.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.nats[count.index].id
        iam             = "DISABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = "nats"
      image     = "nats:2.10-alpine"
      essential = true
      command = [
        "-js",
        "-sd", "/data",
        "-n", "nats-${count.index}",
        "-cluster_name", "${var.name}-nats",
        "-cluster", "nats://0.0.0.0:6222",
        "-routes", local.routes,
        "-m", "8222",
      ]
      portMappings = [
        { containerPort = 4222, protocol = "tcp" },
        { containerPort = 6222, protocol = "tcp" },
        { containerPort = 8222, protocol = "tcp" }
      ]
      mountPoints = [
        { sourceVolume = "data", containerPath = "/data", readOnly = false }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.nats.name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "nats-${count.index}"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:8222/healthz || exit 1"]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])

  tags = var.tags
}

# --- Services (1 task par replica) ---
resource "aws_ecs_service" "nats" {
  count           = var.replicas
  name            = "${var.name}-nats-${count.index}"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.nats[count.index].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.nats.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.nats[count.index].arn
  }

  # Alias commun
  dynamic "service_registries" {
    for_each = count.index == 0 ? [1] : []
    content {
      registry_arn = aws_service_discovery_service.nats_alias.arn
    }
  }

  tags = var.tags
}
