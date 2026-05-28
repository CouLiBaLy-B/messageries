region          = "eu-west-3"
env             = "prod"
domain_name     = "api.example.com"
certificate_arn = "arn:aws:acm:eu-west-3:111122223333:certificate/REPLACE"
alert_emails    = ["ops@example.com", "security@example.com"]
allowed_origins = ["https://app.example.com"]
github_repo     = "yourorg/messagerie"
image_tag       = "latest"
