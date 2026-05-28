terraform {
  backend "s3" {
    bucket         = "REPLACE_WITH_BOOTSTRAP_BUCKET"
    key            = "envs/dr/terraform.tfstate"
    region         = "eu-west-3"
    dynamodb_table = "messaging-tflock-prod"
    encrypt        = true
  }
}
