#!/usr/bin/env bash
set -euo pipefail
# Procédure DR GCP : promote Cloud SQL replica + bascule DNS WRR.
# Usage : ./dr-failover.sh
# Env vars requises :
#   GCP_PROJECT_ID, DR_REGION, DR_DB_INSTANCE,
#   DNS_ZONE, DOMAIN, PRIMARY_IP, DR_IP

PROJECT_ID=${GCP_PROJECT_ID:?missing}
DR_REGION=${DR_REGION:-europe-west4}
DR_DB=${DR_DB_INSTANCE:?missing}
DNS_ZONE=${DNS_ZONE:?missing managed zone name}
DOMAIN=${DOMAIN:?missing FQDN (ex: api.example.com)}
PRIMARY_IP=${PRIMARY_IP:?missing}
DR_IP=${DR_IP:?missing}

echo "🔴 GCP DR FAILOVER START $(date -u)"

echo "→ 1. Promote Cloud SQL replica ${DR_DB}"
gcloud sql instances promote-replica "${DR_DB}" \
  --project "${PROJECT_ID}" \
  --quiet

echo "→ 2. Waiting for instance to become primary..."
for i in $(seq 1 60); do
  STATUS=$(gcloud sql instances describe "${DR_DB}" --project "${PROJECT_ID}" --format='value(state)')
  if [ "${STATUS}" = "RUNNABLE" ]; then
    INSTANCE_ROLE=$(gcloud sql instances describe "${DR_DB}" --project "${PROJECT_ID}" --format='value(instanceType)')
    if [ "${INSTANCE_ROLE}" = "CLOUD_SQL_INSTANCE" ]; then
      echo "  ✔ DB promoted to standalone"
      break
    fi
  fi
  sleep 10
done

echo "→ 3. Bascule DNS WRR : primary 0% / dr 100%"
gcloud dns record-sets update "${DOMAIN}." \
  --type=A \
  --zone="${DNS_ZONE}" \
  --project "${PROJECT_ID}" \
  --routing-policy-type=WRR \
  --routing-policy-data="0=${PRIMARY_IP};100=${DR_IP}" \
  --ttl=60

echo "✅ DR active."
echo ""
echo "ℹ️  Post-failover :"
echo "   - Update Cloud Run env DB_HOST → nouvelle DB DR private IP"
echo "   - Scale up DR Cloud Run services"
echo "   - Recréer un nouveau replica DR depuis la new primary (script dr-rebuild.sh)"
