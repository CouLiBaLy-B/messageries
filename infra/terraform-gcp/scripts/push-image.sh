#!/usr/bin/env bash
set -euo pipefail
# Build & push image vers Artifact Registry.
# Usage : ./push-image.sh <env> <service> [tag]
#   service ∈ {api, ws}
#   ex : ./push-image.sh staging api v0.8.0

ENV=${1:?missing env}
SERVICE=${2:?missing service (api|ws)}
TAG=${3:-$(git rev-parse --short HEAD)}
REGION=${GCP_REGION:-europe-west1}
PROJECT_ID=$(gcloud config get-value project)

case "$SERVICE" in
  api) BUILD_DIR="backend";;
  ws)  BUILD_DIR="ws-gateway";;
  *)   echo "service must be api or ws"; exit 1;;
esac

cd "$(dirname "$0")/../envs/${ENV}"
REPO_URL=$(terraform output -raw artifact_registry_url)
IMAGE="${REPO_URL}/${SERVICE}:${TAG}"

cd "$(dirname "$0")/../../.."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "→ Build linux/amd64 image ${IMAGE}"
docker buildx build --platform linux/amd64 \
  -t "${IMAGE}" \
  -t "${REPO_URL}/${SERVICE}:latest" \
  --push "${BUILD_DIR}"

echo "✅ Pushed ${IMAGE}"
echo ""
echo "Pour déployer :"
echo "  gcloud run deploy messaging-${ENV}-${SERVICE} --image ${IMAGE} --region ${REGION}"
