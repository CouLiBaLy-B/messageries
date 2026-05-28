/**
 * AWS WAF v2 (Regional, pour ALB).
 * Règles managées AWS :
 *  - AWSManagedRulesCommonRuleSet           (CRS adapté)
 *  - AWSManagedRulesKnownBadInputsRuleSet
 *  - AWSManagedRulesSQLiRuleSet
 *  - AWSManagedRulesAmazonIpReputationList
 * + RateBasedRule : 2000 req / 5 min / IP
 */

resource "aws_wafv2_web_acl" "this" {
  name        = "${var.name}-waf"
  description = "Messaging WAF"
  scope       = "REGIONAL"

  default_action { allow {} }

  rule {
    name     = "AWS-Common"
    priority = 1
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "waf-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWS-KnownBadInputs"
    priority = 2
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "waf-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWS-SQLi"
    priority = 3
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "waf-sqli"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWS-IpReputation"
    priority = 4
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "waf-ip-rep"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimit"
    priority = 10
    action { block {} }
    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "waf-rate"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name}-waf"
    sampled_requests_enabled   = true
  }

  tags = var.tags
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = var.alb_arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}
