/**
 * VPC custom + 1 subnet régional + Cloud NAT.
 * + Private Services Access (range alloué pour Cloud SQL/Memorystore).
 * + VPC Access Connector pour Cloud Run → VPC privé.
 */

resource "google_compute_network" "this" {
  name                            = "${var.name}-vpc"
  auto_create_subnetworks         = false
  routing_mode                    = "REGIONAL"
  delete_default_routes_on_create = false
}

resource "google_compute_subnetwork" "app" {
  name                     = "${var.name}-app"
  ip_cidr_range            = var.app_cidr
  region                   = var.region
  network                  = google_compute_network.this.id
  private_ip_google_access = true

  log_config {
    aggregation_interval = "INTERVAL_10_MIN"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

# --- Private Services Access pour Cloud SQL / Memorystore ---
resource "google_compute_global_address" "psa_range" {
  name          = "${var.name}-psa-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.this.id
}

resource "google_service_networking_connection" "psa" {
  network                 = google_compute_network.this.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.psa_range.name]
}

# --- Cloud Router + NAT (pour egress depuis Cloud Run via VPC) ---
resource "google_compute_router" "nat" {
  name    = "${var.name}-nat-router"
  region  = var.region
  network = google_compute_network.this.id
}

resource "google_compute_router_nat" "nat" {
  name                               = "${var.name}-nat"
  router                             = google_compute_router.nat.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# --- VPC Access Connector (Cloud Run → réseau privé) ---
resource "google_vpc_access_connector" "this" {
  name          = "${substr(replace(var.name, "_", "-"), 0, 20)}-vpc-c"
  region        = var.region
  network       = google_compute_network.this.name
  ip_cidr_range = var.connector_cidr
  min_instances = 2
  max_instances = 10
  machine_type  = "e2-micro"
}

# --- Firewall : refuser tout en deny par défaut, autoriser explicite ---
resource "google_compute_firewall" "deny_all_ingress" {
  name      = "${var.name}-deny-all-ingress"
  network   = google_compute_network.this.name
  direction = "INGRESS"
  priority  = 65000
  source_ranges = ["0.0.0.0/0"]
  deny { protocol = "all" }
}

# Allow GCP health checkers vers le subnet app
resource "google_compute_firewall" "allow_health_checks" {
  name        = "${var.name}-allow-hc"
  network     = google_compute_network.this.name
  direction   = "INGRESS"
  priority    = 1000
  source_ranges = ["35.191.0.0/16", "130.211.0.0/22"]
  allow {
    protocol = "tcp"
    ports    = ["3000", "3001", "8080"]
  }
}
