output "url" {
  description = "URL NATS interne (Cloud Map alias)"
  value       = "nats://nats.${var.name}.internal:4222"
}
output "security_group_id" { value = aws_security_group.nats.id }
output "namespace_id"      { value = aws_service_discovery_private_dns_namespace.this.id }
output "namespace_name"    { value = aws_service_discovery_private_dns_namespace.this.name }
