#!/usr/bin/env bash
set -euo pipefail

# Build & push image vers ECR.
# Usage : ./push-image.sh <env> [tag]
#   ex : ./push-image.sh staging v0.2.0

ENV=${1:?missing env}
TAG=${2:-$(git rev-parse --short HEAD)}
REGION=${AWS_REGION:-eu-west-3}

cd "$(dirname "$0")/../terraform/envs/${ENV}"
REPO_URL=$(terraform output -raw ecr_repository_url)
REGISTRY=$(echo "${REPO_URL}" | cut -d/ -f1)

echo "→ Login ECR ${REGISTRY}"
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"

echo "→ Build linux/arm64 image ${REPO_URL}:${TAG}"
cd "$(dirname "$0")/../../backend"
docker buildx build --platform linux/arm64 \
  -t "${REPO_URL}:${TAG}" \
  -t "${REPO_URL}:latest" \
  --push .

echo "✅ Pushed ${REPO_URL}:${TAG}"
echo ""
echo "Pour déployer :"
echo "  aws ecs update-service --cluster messaging-${ENV} --service messaging-${ENV}-api --force-new-deployment --region ${REGION}"
