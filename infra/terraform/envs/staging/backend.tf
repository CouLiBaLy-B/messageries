terraform {
  backend "s3" {
    bucket         = "REPLACE_WITH_BOOTSTRAP_BUCKET" # ex: messaging-tfstate-123456789012-staging
    key            = "envs/staging/terraform.tfstate"
    region         = "eu-west-3"
    dynamodb_table = "messaging-tflock-staging"
    encrypt        = true
  }
}
