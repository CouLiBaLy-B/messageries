output "host"        { value = google_redis_instance.this.host }
output "port"        { value = google_redis_instance.this.port }
output "auth_string" {
  value     = google_redis_instance.this.auth_string
  sensitive = true
}
output "current_location_id" { value = google_redis_instance.this.current_location_id }
output "server_ca_certs"     { value = google_redis_instance.this.server_ca_certs }
