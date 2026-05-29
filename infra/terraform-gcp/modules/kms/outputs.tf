output "keyring_id"     { value = google_kms_key_ring.this.id }
output "db_key_id"      { value = google_kms_crypto_key.db.id }
output "gcs_key_id"     { value = google_kms_crypto_key.gcs.id }
output "app_key_id"     { value = google_kms_crypto_key.app.id }
output "logs_key_id"    { value = google_kms_crypto_key.logs.id }
output "app_key_name"   { value = google_kms_crypto_key.app.name }
