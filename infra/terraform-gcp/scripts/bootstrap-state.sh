#!/usr/bin/env bash
set -euo pipefail
# Bootstrap GCS state bucket.
# Usage : ./bootstrap-state.sh <env> <region>

ENV=${1:?missing env}
REGION=${2:?missing region}
PROJECT_ID=$(gcloud config get-value project)
BUCKET="messaging-tfstate-${PROJECT_ID}-${ENV}"

echo "→ Bucket : ${BUCKET}"
if gsutil ls "gs://${BUCKET}" >/dev/null 2>&1; then
  echo "✔ Bucket déjà existant"
else
  gsutil mb -p "${PROJECT_ID}" -l "${REGION}" -b on "gs://${BUCKET}"
fi

# Versioning + lifecycle
gsutil versioning set on "gs://${BUCKET}"
gsutil iam ch "allUsers:objectViewer:notExist" "gs://${BUCKET}" 2>/dev/null || true
gsutil pap set enforced "gs://${BUCKET}"

echo ""
echo "✅ Done. Renseigne dans envs/${ENV}/backend.tf :"
echo "   bucket = \"${BUCKET}\""
