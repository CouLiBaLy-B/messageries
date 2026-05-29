output "uptime_check_id" {
  value = google_monitoring_uptime_check_config.primary.uptime_check_id
}
output "record_name" { value = google_dns_record_set.failover.name }
