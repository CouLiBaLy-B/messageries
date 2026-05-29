resource "google_artifact_registry_repository" "this" {
  location      = var.region
  repository_id = "${var.name}-docker"
  description   = "Docker images for ${var.name}"
  format        = "DOCKER"

  docker_config {
    immutable_tags = true
  }

  cleanup_policies {
    id     = "keep-last-20"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }
  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s" # 7j
    }
  }
}
