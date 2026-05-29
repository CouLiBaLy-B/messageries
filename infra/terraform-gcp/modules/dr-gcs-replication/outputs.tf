output "dr_bucket_name" { value = google_storage_bucket.dr.name }
output "transfer_job_name" { value = google_storage_transfer_job.this.name }
output "sts_service_account_email" {
  value = data.google_storage_transfer_project_service_account.this.email
}
