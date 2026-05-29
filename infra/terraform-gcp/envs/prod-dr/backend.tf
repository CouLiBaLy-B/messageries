terraform {
  backend "gcs" {
    bucket = "REPLACE_WITH_BOOTSTRAP_BUCKET"
    prefix = "envs/prod-dr"
  }
}
