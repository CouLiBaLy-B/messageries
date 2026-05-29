/**
 * NATS JetStream sur GKE Autopilot (opt-in Phase 5).
 *
 * GKE Autopilot = pas de gestion de nodes, billing per pod.
 * StatefulSet 3 replicas avec PVC SSD (équivalent EFS sur AWS).
 *
 * Le manifest Kubernetes lui-même est appliqué via Helm/kubectl en post-déploiement
 * (Terraform crée juste le cluster + l'IP). Le but ici n'est pas de reproduire
 * tout l'opérationnel Kubernetes, mais de fournir le socle.
 */

resource "google_container_cluster" "this" {
  name     = "${var.name}-nats"
  location = var.region

  enable_autopilot = true
  release_channel { channel = "REGULAR" }

  network    = var.vpc_self_link
  subnetwork = var.subnet_self_link

  ip_allocation_policy {
    cluster_ipv4_cidr_block  = "10.40.0.0/16"
    services_ipv4_cidr_block = "10.41.0.0/20"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  master_authorized_networks_config {
    dynamic "cidr_blocks" {
      for_each = var.authorized_master_cidrs
      content {
        cidr_block   = cidr_blocks.value
        display_name = cidr_blocks.value
      }
    }
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  deletion_protection = false
}

resource "google_service_account" "nats" {
  account_id   = "${var.name}-nats"
  display_name = "NATS JetStream on GKE"
}
