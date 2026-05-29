output "cluster_name"       { value = google_container_cluster.this.name }
output "cluster_endpoint"   { value = google_container_cluster.this.endpoint, sensitive = true }
output "cluster_ca_cert"    { value = google_container_cluster.this.master_auth[0].cluster_ca_certificate, sensitive = true }
output "sa_email"           { value = google_service_account.nats.email }
output "nats_url_hint" {
  description = "URL DNS interne attendue après installation Helm (ex: nats://nats.default.svc.cluster.local:4222)"
  value       = "nats://nats.default.svc.cluster.local:4222"
}
