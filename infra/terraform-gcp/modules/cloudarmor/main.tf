/**
 * Cloud Armor — équivalent AWS WAF :
 *  - OWASP CRS preconfigured (xss, sqli, lfi, rfi, etc.)
 *  - Rate limit IP : 2000 req / 5 min
 *  - Adaptive Protection (anti-DDoS L7)
 */

resource "google_compute_security_policy" "this" {
  name        = "${var.name}-armor"
  description = "Cloud Armor for ${var.name}"

  adaptive_protection_config {
    layer_7_ddos_defense_config { enable = true }
  }

  # SQLi
  rule {
    action   = "deny(403)"
    priority = 1000
    description = "OWASP SQLi"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sqli-v33-stable', ['owasp-crs-v030301-id942110-sqli'])"
      }
    }
  }

  # XSS
  rule {
    action   = "deny(403)"
    priority = 1001
    description = "OWASP XSS"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('xss-v33-stable')"
      }
    }
  }

  # LFI
  rule {
    action   = "deny(403)"
    priority = 1002
    description = "OWASP LFI"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('lfi-v33-stable')"
      }
    }
  }

  # RFI
  rule {
    action   = "deny(403)"
    priority = 1003
    description = "OWASP RFI"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('rfi-v33-stable')"
      }
    }
  }

  # Protocol attacks
  rule {
    action   = "deny(403)"
    priority = 1004
    description = "OWASP protocol attack"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('protocolattack-v33-stable')"
      }
    }
  }

  # Rate limit
  rule {
    action   = "rate_based_ban"
    priority = 2000
    description = "Rate limit per IP"
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
    rate_limit_options {
      conform_action   = "allow"
      exceed_action    = "deny(429)"
      enforce_on_key   = "IP"
      ban_duration_sec = 600
      rate_limit_threshold {
        count        = var.rate_limit_per_5min
        interval_sec = 300
      }
    }
  }

  # Default
  rule {
    action   = "allow"
    priority = 2147483647
    description = "Default allow"
    match {
      versioned_expr = "SRC_IPS_V1"
      config { src_ip_ranges = ["*"] }
    }
  }
}
