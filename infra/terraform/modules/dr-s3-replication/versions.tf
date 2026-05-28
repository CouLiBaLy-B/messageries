/**
 * Le module utilise 2 providers AWS (source + destination = par défaut).
 * Terraform exige une déclaration explicite via configuration_aliases
 * pour qu'on puisse faire `providers = { aws.source = ... }` à l'instanciation.
 */
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.40"
      configuration_aliases = [aws.source]
    }
  }
}
