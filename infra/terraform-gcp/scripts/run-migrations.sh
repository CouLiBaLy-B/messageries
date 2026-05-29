#!/usr/bin/env bash
set -euo pipefail
# Lance les migrations via Cloud Run Job (one-shot).
# Usage : ./run-migrations.sh <env>

ENV=${1:?missing env}
REGION=${GCP_REGION:-europe-west1}
PROJECT_ID=$(gcloud config get-value project)
SERVICE="messaging-${ENV}-api"
JOB_NAME="${SERVICE}-migrate"

cd "$(dirname "$0")/../envs/${ENV}"
REPO_URL=$(terraform output -raw artifact_registry_url)
SA_EMAIL=$(gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(spec.template.spec.serviceAccountName)')
IMAGE=$(gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(spec.template.spec.containers[0].image)')

# Crée ou met à jour le job
gcloud run jobs deploy "${JOB_NAME}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --service-account "${SA_EMAIL}" \
  --task-timeout=600s \
  --max-retries=1 \
  --command "sh" --args "-c,npm run migration:run"

echo "→ Executing job"
gcloud run jobs execute "${JOB_NAME}" --region "${REGION}" --wait
echo "✅ Migrations OK"
