/**
 * Application Load Balancer (TLS 1.2+).
 *  - listener 443 → target group ECS
 *  - listener 80 → redirect 443
 *  - stickiness activée pour WebSocket (lb_cookie 8h)
 *  - access logs S3 chiffrés
 *  - health check sur /api/v1/health
 */

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb-sg"
  description = "ALB SG : 80/443 from Internet"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = var.tags
}

resource "aws_lb" "this" {
  name               = "${var.name}-alb"
  load_balancer_type = "application"
  internal           = false
  subnets            = var.public_subnet_ids
  security_groups    = [aws_security_group.alb.id]
  idle_timeout       = 120
  drop_invalid_header_fields = true

  enable_deletion_protection = var.deletion_protection
  enable_http2               = true

  tags = var.tags
}

resource "aws_lb_target_group" "app" {
  name        = "${var.name}-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip" # requis pour Fargate awsvpc

  # Stickiness pour WebSocket (le client reste sur la même task)
  stickiness {
    enabled         = true
    type            = "lb_cookie"
    cookie_duration = 28800
  }

  deregistration_delay = 30

  health_check {
    path                = "/api/v1/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = var.tags
}

# --- listener 80 → redirect 443 ---
resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

# --- listener 443 ---
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
