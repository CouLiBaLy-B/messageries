#!/usr/bin/env bash
set -euo pipefail
# Procédure DR GCP — failover complet :
#   1. Promote Cloud SQL replica → standalone
#   2. Update Cloud Run DR : OUTBOX_WORKER_ENABLED=true + min_instances ≥ 2
#   3. Bascule DNS WRR → 0/100 (primary → DR)
#
# Usage : ./dr-failover.sh
#
# Env vars requises :
#   GCP_PROJECT_ID, DR_REGION, DR_DB_INSTANCE,
#   DR_API_SERVICE, DNS_ZONE, DOMAIN, PRIMARY_IP, DR_IP
# Optionnel :
#   DR_MIN_INSTANCES (def: 2)
#   DR_TARGET_DB_HOST (def: récupéré via gcloud)

PROJECT_ID=${GCP_PROJECT_ID:?missing}
DR_REGION=${DR_REGION:-europe-west4}
DR_DB=${DR_DB_INSTANCE:?missing (ex: messaging-prod-dr-pg)}
DR_API=${DR_API_SERVICE:?missing (ex: messaging-prod-dr-api)}
DNS_ZONE=${DNS_ZONE:?missing managed zone name}
DOMAIN=${DOMAIN:?missing FQDN}
PRIMARY_IP=${PRIMARY_IP:?missing}
DR_IP=${DR_IP:?missing}
DR_MIN_INSTANCES=${DR_MIN_INSTANCES:-2}

echo "🔴 GCP DR FAILOVER START $(date -u)"
echo "  Project=${PROJECT_ID} DR region=${DR_REGION}"

# --- 1. Promote DB ---
echo ""
echo "→ [1/4] Promote Cloud SQL replica ${DR_DB}"
gcloud sql instances promote-replica "${DR_DB}" \
  --project "${PROJECT_ID}" \
  --quiet

echo "    Waiting for instance to become standalone..."
for i in $(seq 1 60); do
  STATE=$(gcloud sql instances describe "${DR_DB}" --project "${PROJECT_ID}" --format='value(state)')
  ROLE=$(gcloud sql instances describe "${DR_DB}" --project "${PROJECT_ID}" --format='value(instanceType)')
  if [ "${STATE}" = "RUNNABLE" ] && [ "${ROLE}" = "CLOUD_SQL_INSTANCE" ]; then
    echo "    ✔ DB promoted to standalone"
    break
  fi
  sleep 10
done

# --- 2. Récupérer la nouvelle IP private (peut changer après promote) ---
NEW_DB_HOST=${DR_TARGET_DB_HOST:-$(gcloud sql instances describe "${DR_DB}" \
  --project "${PROJECT_ID}" \
  --format='value(ipAddresses[0].ipAddress)')}
echo "    New DB private IP: ${NEW_DB_HOST}"

# --- 3. Update Cloud Run DR : activer outbox + min_instances ≥ 2 ---
echo ""
echo "→ [2/4] Update Cloud Run ${DR_API} : OUTBOX_WORKER_ENABLED=true, min=${DR_MIN_INSTANCES}"
gcloud run services update "${DR_API}" \
  --region "${DR_REGION}" \
  --project "${PROJECT_ID}" \
  --update-env-vars "OUTBOX_WORKER_ENABLED=true,DB_HOST=${NEW_DB_HOST}" \
  --min-instances "${DR_MIN_INSTANCES}" \
  --quiet

# --- 4. Attendre que le service soit ready ---
echo ""
echo "→ [3/4] Waiting for Cloud Run revision ready..."
gcloud run services describe "${DR_API}" \
  --region "${DR_REGION}" \
  --project "${PROJECT_ID}" \
  --format='value(status.url)' > /tmp/dr_url
echo "    URL: $(cat /tmp/dr_url)"

# --- 5. DNS bascule ---
echo ""
echo "→ [4/4] DNS WRR : primary 0% / dr 100%"
gcloud dns record-sets update "${DOMAIN}." \
  --type=A \
  --zone="${DNS_ZONE}" \
  --project "${PROJECT_ID}" \
  --routing-policy-type=WRR \
  --routing-policy-data="0=${PRIMARY_IP};100=${DR_IP}" \
  --ttl=60

echo ""
echo "✅ FAILOVER COMPLETE $(date -u)"
echo ""
echo "ℹ️  Vérifications post-failover :"
echo "   curl https://${DOMAIN}/api/v1/health"
echo "   gcloud run services logs read ${DR_API} --region ${DR_REGION} --project ${PROJECT_ID} --limit 50"
echo ""
echo "⚠️  Actions manuelles :"
echo "   - Recréer un nouveau Cloud SQL replica depuis la nouvelle primary"
echo "   - Mettre à jour envs/dr/terraform.tfvars (inversion primary↔DR)"
echo "   - Communication clients / status page"
