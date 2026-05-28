/**
 * WS Gateway = service ECS Fargate exposé via NLB (TCP/TLS).
 *
 * NLB préféré à ALB pour WebSockets long-lived :
 *  - idle timeout 350s (vs 60s ALB par défaut)
 *  - TLS termination au NLB (security policy moderne)
 *  - cible IP (Fargate awsvpc)
 *  - cross-zone activé
 *
 * 2 services ECS (api + ws-gateway) partagent : VPC, secrets, KMS, logs.
 */

data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.logs_kms_key_arn
  tags              = var.tags
}

# --- NLB ---
resource "aws_lb" "this" {
  name                             = "${var.name}-nlb"
  load_balancer_type               = "network"
  internal                         = false
  subnets                          = var.public_subnet_ids
  enable_cross_zone_load_balancing = true
  enable_deletion_protection       = var.deletion_protection
  tags                             = var.tags
}

resource "aws_lb_target_group" "ws" {
  name                 = "${var.name}-tg"
  port                 = 3001
  protocol             = "TCP"
  vpc_id               = var.vpc_id
  target_type          = "ip"
  deregistration_delay = 30
  preserve_client_ip   = true

  health_check {
    protocol            = "HTTP"
    path                = "/healthz"
    port                = "3001"
    matcher             = "200"
    interval            = 15
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  stickiness {
    enabled = true
    type    = "source_ip"
  }

  tags = var.tags
}

resource "aws_lb_listener" "tls" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "TLS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  alpn_policy       = "HTTP2Optional"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ws.arn
  }
}

# --- SG WS task ---
resource "aws_security_group" "task" {
  name        = "${var.name}-task-sg"
  description = "WS gateway task SG : ingress 3001 from NLB target IPs"
  vpc_id      = var.vpc_id

  # NLB ne propage pas de SG : on autorise depuis la VPC CIDR
  ingress {
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

# --- ECS service (réutilise le cluster existant via cluster_name) ---
resource "aws_ecs_task_definition" "ws" {
  family                   = "${var.name}-ws"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn

  container_definitions = jsonencode([
    {
      name      = "ws"
      image     = var.image_uri
      essential = true
      portMappings = [
        { containerPort = 3001, protocol = "tcp" }
      ]
      environment = [for k, v in var.environment : { name = k, value = tostring(v) }]
      secrets = [
        { name = "JWT_SECRET", valueFrom = var.jwt_secret_arn },
        { name = "REDIS_PASSWORD", valueFrom = var.redis_auth_arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.this.name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "ws"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:3001/healthz || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }
    }
  ])

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  tags = var.tags
}

resource "aws_ecs_service" "ws" {
  name             = "${var.name}-ws"
  cluster          = var.ecs_cluster_arn
  task_definition  = aws_ecs_task_definition.ws.arn
  desired_count    = var.desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  network_configuration {
    subnets          = var.app_subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.ws.arn
    container_name   = "ws"
    container_port   = 3001
  }

  deployment_controller { type = "ECS" }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  health_check_grace_period_seconds = 30
  lifecycle { ignore_changes = [desired_count] }

  tags = var.tags
}

# --- Autoscaling sur CPU + connexions actives (proxy : tcp_target_response_time pas dispo NLB) ---
resource "aws_appautoscaling_target" "ws" {
  max_capacity       = var.max_capacity
  min_capacity       = var.min_capacity
  resource_id        = "service/${var.ecs_cluster_name}/${aws_ecs_service.ws.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.name}-ws-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ws.resource_id
  scalable_dimension = aws_appautoscaling_target.ws.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ws.service_namespace
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
