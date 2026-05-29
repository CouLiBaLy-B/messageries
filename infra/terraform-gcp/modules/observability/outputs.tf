output "channel_ids" {
  value = [for c in google_monitoring_notification_channel.email : c.id]
}
