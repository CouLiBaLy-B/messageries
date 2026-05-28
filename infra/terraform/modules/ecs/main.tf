/**
 * ECS Fargate cluster + service + task definition.
 * + ADOT collector sidecar (X-Ray) si tracing_enabled.
 */

data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "otel" {
  count             = var.tracing_enabled ? 1 : 0
  name              = "/ecs/${var.name}/otel"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  tags              = var.tags
}

resource "aws_security_group" "task" {
  name        = "${var.name}-task-sg"
  description = "ECS task SG : ingress 3000 from ALB only"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [var.alb_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_ecs_cluster" "this" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = var.tags
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

locals {
  app_container = {
    name      = "api"
    image     = var.image_uri
    essential = true
    portMappings = [
      { containerPort = 3000, protocol = "tcp" }
    ]
    environment = concat(
      [for k, v in var.environment : { name = k, value = tostring(v) }],
      var.tracing_enabled ? [
        { name = "TRACING_ENABLED", value = "true" },
        { name = "OTEL_EXPORTER_OTLP_ENDPOINT", value = "http://localhost:4318/v1/traces" },
        { name = "OTEL_SERVICE_NAME", value = "${var.name}-api" }
      ] : []
    )
    secrets = [
      { name = "JWT_SECRET", valueFrom = var.jwt_secret_arn },
      { name = "DB_PASSWORD", valueFrom = var.db_password_arn },
      { name = "REDIS_PASSWORD", valueFrom = var.redis_auth_arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this.name
        awslogs-region        = data.aws_region.current.name
        awslogs-stream-prefix = "api"
      }
    }
    readonlyRootFilesystem = false
    linuxParameters = {
      initProcessEnabled = true
    }
    ulimits = [
      { name = "nofile", softLimit = 65536, hardLimit = 65536 }
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    dependsOn = var.tracing_enabled ? [{
      containerName = "aws-otel-collector"
      condition     = "START"
    }] : []
  }

  otel_container = var.tracing_enabled ? [{
    name      = "aws-otel-collector"
    image     = "public.ecr.aws/aws-observability/aws-otel-collector:v0.40.0"
    essential = true
    command   = ["--config=/etc/ecs/ecs-default-config.yaml"]
    environment = [
      { name = "AOT_CONFIG_CONTENT", value = "" }
    ]
    portMappings = [
      { containerPort = 4318, protocol = "tcp" }, # OTLP HTTP
      { containerPort = 4317, protocol = "tcp" }  # OTLP gRPC
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.otel[0].name
        awslogs-region        = data.aws_region.current.name
        awslogs-stream-prefix = "otel"
      }
    }
  }] : []
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${var.name}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode(concat([local.app_container], local.otel_container))

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  tags = var.tags
}

resource "aws_ecs_service" "app" {
  name                   = "${var.name}-api"
  cluster                = aws_ecs_cluster.this.id
  task_definition        = aws_ecs_task_definition.app.arn
  desired_count          = var.desired_count
  launch_type            = "FARGATE"
  platform_version       = "LATEST"
  enable_execute_command = true
  propagate_tags         = "SERVICE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_controller { type = "ECS" }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  health_check_grace_period_seconds = 60
  wait_for_steady_state             = false

  lifecycle {
    ignore_changes = [desired_count]
  }

  tags = var.tags
}

resource "aws_appautoscaling_target" "app" {
  max_capacity       = var.max_capacity
  min_capacity       = var.min_capacity
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.app.resource_id
  scalable_dimension = aws_appautoscaling_target.app.scalable_dimension
  service_namespace  = aws_appautoscaling_target.app.service_namespace
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    scale_in_cooldown  = 120
    scale_out_cooldown = 30
  }
}

resource "aws_appautoscaling_policy" "alb_req" {
  name               = "${var.name}-alb-req"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.app.resource_id
  scalable_dimension = aws_appautoscaling_target.app.scalable_dimension
  service_namespace  = aws_appautoscaling_target.app.service_namespace
  target_tracking_scaling_policy_configuration {
    target_value = 500
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = var.alb_target_resource_label
    }
    scale_in_cooldown  = 180
    scale_out_cooldown = 30
  }
}
