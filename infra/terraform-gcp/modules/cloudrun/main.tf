/**
 * Service Cloud Run (v2, second génération).
 *
 *  - VPC egress all-traffic via connector (accès Cloud SQL/Memorystore privé)
 *  - Secrets injectés depuis Secret Manager via env "valueSource"
 *  - Autoscale min/max
 *  - Concurrency par instance
 *  - WebSocket : Cloud Run gère HTTP/2 streaming nativement (pas besoin de NLB)
 *
 *  Le module est générique : utilisé pour "api" ET "ws-gateway".
 */

resource "google_cloud_run_v2_service" "this" {
  name     = var.name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" # exposé uniquement via LB externe
  launch_stage = "GA"

  template {
    service_account = var.service_account_email
    timeout         = "${var.timeout_seconds}s"

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    vpc_access {
      connector = var.vpc_connector
      egress    = "ALL_TRAFFIC"
    }

    max_instance_request_concurrency = var.concurrency

    containers {
      image = var.image_uri

      resources {
        cpu_idle = false # CPU always allocated (pour WS / outbox worker)
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        startup_cpu_boost = true
      }

      ports {
        name           = "http1"
        container_port = var.container_port
      }

      dynamic "env" {
        for_each = var.environment
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = var.health_path
          port = var.container_port
        }
        initial_delay_seconds = 10
        period_seconds        = 5
        timeout_seconds       = 3
        failure_threshold     = 5
      }

      liveness_probe {
        http_get {
          path = var.health_path
          port = var.container_port
        }
        initial_delay_seconds = 30
        period_seconds        = 30
        timeout_seconds       = 5
        failure_threshold     = 3
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  lifecycle {
    ignore_changes = [
      # L'image peut être mise à jour via CI (gcloud run deploy) sans déclencher TF
      template[0].containers[0].image,
    ]
  }
}
