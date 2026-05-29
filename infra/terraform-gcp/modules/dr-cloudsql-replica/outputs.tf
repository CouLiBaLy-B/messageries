output "instance_name"   { value = google_sql_database_instance.replica.name }
output "connection_name" { value = google_sql_database_instance.replica.connection_name }
output "private_ip"      { value = google_sql_database_instance.replica.private_ip_address }
