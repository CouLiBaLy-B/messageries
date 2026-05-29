terraform {
  backend "gcs" {
    bucket = "REPLACE_WITH_BOOTSTRAP_BUCKET" # ex: messaging-tfstate-<projet>-staging
    prefix = "envs/prod"
  }
}
