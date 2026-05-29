/**
 * GCP n'a pas d'équivalent managé direct de Amazon OpenSearch Service.
 * Recommandation : Elastic Cloud on GCP (partenaire officiel),
 * accessible via PrivateLink / Private Service Connect.
 *
 * Ce module est volontairement vide — il sert de doc et d'emplacement
 * futur pour automatiser l'inscription Elastic Cloud via leur provider TF
 * (`elastic/ec`) ou pour déployer OpenSearch self-hosted sur GKE.
 */

# Placeholder : on stocke juste le endpoint configuré côté Cloud Run via secret
resource "google_secret_manager_secret" "endpoint" {
  count     = var.endpoint == "" ? 0 : 1
  secret_id = "${var.name}-opensearch-endpoint"
  replication { auto {} }
}

resource "google_secret_manager_secret_version" "endpoint" {
  count       = var.endpoint == "" ? 0 : 1
  secret      = google_secret_manager_secret.endpoint[0].id
  secret_data = var.endpoint
}
