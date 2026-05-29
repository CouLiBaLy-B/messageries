/**
 * HTTPS Load Balancer externe global + cert managé + Cloud Armor.
 * Backend = Serverless NEG vers Cloud Run.
 *
 * Le NEG serverless route directement vers Cloud Run, qui supporte HTTP/2 + WebSocket.
 */

resource "google_compute_region_network_endpoint_group" "neg" {
  for_each              = var.cloud_run_services
  name                  = "${var.name}-neg-${each.key}"
  network_endpoint_type = "SERVERLESS"
  region                = each.value.region
  cloud_run {
    service = each.value.service_name
  }
}

resource "google_compute_backend_service" "this" {
  for_each              = var.cloud_run_services
  name                  = "${var.name}-be-${each.key}"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  enable_cdn            = false
  timeout_sec           = each.value.timeout_sec
  security_policy       = var.security_policy_id

  log_config {
    enable      = true
    sample_rate = 1.0
  }

  backend {
    group = google_compute_region_network_endpoint_group.neg[each.key].id
  }
}

# --- URL map : route par hostname (api.* → api, ws.* → ws) ---
resource "google_compute_url_map" "this" {
  name = "${var.name}-url-map"

  default_service = google_compute_backend_service.this[var.default_backend].id

  dynamic "host_rule" {
    for_each = var.cloud_run_services
    content {
      hosts        = [host_rule.value.host]
      path_matcher = "pm-${host_rule.key}"
    }
  }

  dynamic "path_matcher" {
    for_each = var.cloud_run_services
    content {
      name            = "pm-${path_matcher.key}"
      default_service = google_compute_backend_service.this[path_matcher.key].id
    }
  }
}

# --- Cert managé ---
resource "google_compute_managed_ssl_certificate" "this" {
  name = "${var.name}-cert"
  managed {
    domains = [for s in var.cloud_run_services : s.host]
  }
}

resource "google_compute_target_https_proxy" "this" {
  name             = "${var.name}-https-proxy"
  url_map          = google_compute_url_map.this.id
  ssl_certificates = [google_compute_managed_ssl_certificate.this.id]
  ssl_policy       = google_compute_ssl_policy.this.id
  http_keep_alive_timeout_sec = 610
}

resource "google_compute_ssl_policy" "this" {
  name            = "${var.name}-ssl-policy"
  min_tls_version = "TLS_1_2"
  profile         = "MODERN"
}

resource "google_compute_global_address" "this" {
  name = "${var.name}-ip"
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "${var.name}-fr-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.this.address
  port_range            = "443"
  target                = google_compute_target_https_proxy.this.id
}

# --- HTTP → HTTPS redirect ---
resource "google_compute_url_map" "redirect" {
  name = "${var.name}-redirect"
  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "${var.name}-http-redirect"
  url_map = google_compute_url_map.redirect.id
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  name                  = "${var.name}-fr-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.this.address
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect.id
}
