output "url" {
  description = "URL NATS interne — liste séparée par virgules (le client NATS fait le round-robin/failover)"
  value       = join(",", [
    for i in range(var.replicas) :
    "nats://nats-${i}.${var.name}.internal:4222"
  ])
}
output "security_group_id" { value = aws_security_group.nats.id }
output "namespace_id"      { value = aws_service_discovery_private_dns_namespace.this.id }
output "namespace_name"    { value = aws_service_discovery_private_dns_namespace.this.name }
