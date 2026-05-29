/**
 * Cloud Monitoring : channel email + 6 alertes critiques.
 * Dashboards à créer via console ou fichier JSON séparé.
 */

resource "google_monitoring_notification_channel" "email" {
  for_each     = toset(var.alert_emails)
  display_name = "Email ${each.value}"
  type         = "email"
  labels       = { email_address = each.value }
}

locals {
  channel_ids = [for c in google_monitoring_notification_channel.email : c.id]
}

# --- Cloud Run 5xx ---
resource "google_monitoring_alert_policy" "cloudrun_5xx" {
  display_name = "${var.name} Cloud Run 5xx"
  combiner     = "OR"
  conditions {
    display_name = "5xx > 10/min"
    condition_threshold {
      filter = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.label.response_code_class=\"5xx\""
      duration        = "120s"
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }
  notification_channels = local.channel_ids
}

# --- Cloud Run latence p95 ---
resource "google_monitoring_alert_policy" "cloudrun_latency" {
  display_name = "${var.name} Cloud Run latency p95 > 1.5s"
  combiner     = "OR"
  conditions {
    display_name = "p95 latency"
    condition_threshold {
      filter = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_latencies\""
      duration        = "180s"
      comparison      = "COMPARISON_GT"
      threshold_value = 1500
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_PERCENTILE_95"
      }
    }
  }
  notification_channels = local.channel_ids
}

# --- Cloud SQL CPU ---
resource "google_monitoring_alert_policy" "sql_cpu" {
  display_name = "${var.name} Cloud SQL CPU > 80%"
  combiner     = "OR"
  conditions {
    display_name = "cpu"
    condition_threshold {
      filter = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = local.channel_ids
}

# --- Cloud SQL disk ---
resource "google_monitoring_alert_policy" "sql_disk" {
  display_name = "${var.name} Cloud SQL disk > 80%"
  combiner     = "OR"
  conditions {
    display_name = "disk"
    condition_threshold {
      filter = "resource.type=\"cloudsql_database\" AND metric.type=\"cloudsql.googleapis.com/database/disk/utilization\""
      duration        = "120s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = local.channel_ids
}

# --- Métriques applicatives custom ---
# Note : "RefreshTokenReplayDetected" est publié comme custom metric par l'app
resource "google_monitoring_alert_policy" "refresh_replay" {
  display_name = "🚨 ${var.name} Refresh token replay detected"
  combiner     = "OR"
  conditions {
    display_name = "replay >= 1"
    condition_threshold {
      filter = "metric.type=\"custom.googleapis.com/messaging/RefreshTokenReplayDetected\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
  notification_channels = local.channel_ids
}

resource "google_monitoring_alert_policy" "outbox_lag" {
  display_name = "${var.name} Outbox lag > 60s"
  combiner     = "OR"
  conditions {
    display_name = "lag seconds"
    condition_threshold {
      filter = "metric.type=\"custom.googleapis.com/messaging/OutboxLagSeconds\""
      duration        = "180s"
      comparison      = "COMPARISON_GT"
      threshold_value = 60
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }
  notification_channels = local.channel_ids
}
