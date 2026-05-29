/**
 * Cloud DNS failover géré via routing_policy WRR + monitoring alert.
 *
 * Pourquoi WRR + alert plutôt que primary_backup natif :
 *  - primary_backup routing_policy de Cloud DNS est conçu pour Internal LB,
 *    pas pour deux LB externes globaux distincts dans des régions différentes.
 *  - WRR (Weighted Round Robin) permet de configurer 100/0 → 0/100 par script.
 *  - Une uptime check + alert policy Cloud Monitoring notifient l'incident,
 *    et le script `dr-failover.sh` bascule les poids.
 *
 * RTO : TTL DNS (60s) + temps de bascule manuelle/automatisée (~ 5 min)
 *       + promote replica Cloud SQL (~3 min) = ~10 min.
 */

data "google_dns_managed_zone" "this" {
  name    = var.dns_managed_zone_name
  project = var.project_id
}

resource "google_dns_record_set" "failover" {
  name         = "${var.record_name}."
  managed_zone = data.google_dns_managed_zone.this.name
  project      = var.project_id
  type         = "A"
  ttl          = 60

  routing_policy {
    wrr {
      weight  = 100
      rrdatas = [var.primary_ip]
    }
    wrr {
      weight  = 0
      rrdatas = [var.dr_ip]
    }
  }

  # Une fois en prod, le script `dr-failover.sh` modifie les poids via gcloud.
  # On ignore ces changements pour ne pas que TF refasse rouler le bascule.
  lifecycle {
    ignore_changes = [routing_policy]
  }
}

# --- Uptime check primary ---
resource "google_monitoring_uptime_check_config" "primary" {
  display_name = "${var.record_name} primary uptime"
  project      = var.project_id
  timeout      = "10s"
  period       = "60s"

  http_check {
    path           = "/api/v1/health"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = var.record_name
      project_id = var.project_id
    }
  }
}

# --- Alert policy : si le primary fail 3× → notification ---
resource "google_monitoring_alert_policy" "primary_down" {
  display_name = "${var.record_name} PRIMARY UNHEALTHY — DR may be needed"
  project      = var.project_id
  combiner     = "OR"
  conditions {
    display_name = "Uptime check failed"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.primary.uptime_check_id}\" AND resource.type=\"uptime_url\""
      duration        = "180s"
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_FRACTION_TRUE"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
      }
      trigger { count = 1 }
    }
  }
  notification_channels = var.notification_channels
  alert_strategy {
    auto_close = "1800s"
  }
}
