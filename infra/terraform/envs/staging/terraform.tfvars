region          = "eu-west-3"
env             = "staging"
domain_name     = "staging.api.example.com"
certificate_arn = "arn:aws:acm:eu-west-3:111122223333:certificate/REPLACE"
alert_emails    = ["devops@example.com"]
allowed_origins = ["https://staging.app.example.com"]
github_repo     = "yourorg/messagerie"
image_tag       = "latest"
