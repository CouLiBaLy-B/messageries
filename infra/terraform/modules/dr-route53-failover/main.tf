/**
 * Route 53 failover :
 *  - record PRIMARY → ALB primary (health check)
 *  - record SECONDARY → ALB DR
 *  - Si health check primary fail → trafic bascule SECONDARY automatiquement
 *
 *  RTO = TTL DNS (60s) + temps de promote replica RDS + ECS DR scale-up.
 */

resource "aws_route53_health_check" "primary" {
  fqdn              = var.primary_alb_dns
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/v1/health"
  failure_threshold = 3
  request_interval  = 30
  measure_latency   = true
  regions           = ["us-east-1", "us-west-2", "eu-west-1"]
  tags              = var.tags
}

resource "aws_route53_record" "primary" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 60

  set_identifier  = "primary"
  failover_routing_policy { type = "PRIMARY" }
  health_check_id = aws_route53_health_check.primary.id
  alias {
    name                   = var.primary_alb_dns
    zone_id                = var.primary_alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "secondary" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"
  ttl     = 60

  set_identifier = "secondary"
  failover_routing_policy { type = "SECONDARY" }
  alias {
    name                   = var.dr_alb_dns
    zone_id                = var.dr_alb_zone_id
    evaluate_target_health = true
  }
}

# Alarme CloudWatch sur l'état du health check
resource "aws_cloudwatch_metric_alarm" "primary_health" {
  alarm_name          = "${var.domain_name}-r53-primary-unhealthy"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  dimensions          = { HealthCheckId = aws_route53_health_check.primary.id }
  alarm_actions       = [var.sns_topic_arn]
  alarm_description   = "Primary endpoint unhealthy → trafic basculé sur DR"
  tags                = var.tags
}
