output "ip_address" { value = google_compute_global_address.this.address }
output "cert_name"  { value = google_compute_managed_ssl_certificate.this.name }
output "url_map_id" { value = google_compute_url_map.this.id }
