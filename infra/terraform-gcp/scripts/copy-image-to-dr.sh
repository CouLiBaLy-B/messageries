#!/usr/bin/env bash
set -euo pipefail
# Copie une image Docker du registry primary vers le registry DR.
# Useful pour avoir la MÊME image (immutable) prête à servir au failover.
#
# Usage : ./copy-image-to-dr.sh <env> <service> <tag>
#   ex : ./copy-image-to-dr.sh prod api v0.9.0

ENV=${1:?missing env}
SERVICE=${2:?missing service (api|ws)}
TAG=${3:?missing tag}
PRIMARY_REGION=${PRIMARY_REGION:-europe-west1}
DR_REGION=${DR_REGION:-europe-west4}
PROJECT_ID=$(gcloud config get-value project)

PRIMARY="${PRIMARY_REGION}-docker.pkg.dev/${PROJECT_ID}/messaging-${ENV}-docker/${SERVICE}:${TAG}"
DR="${DR_REGION}-docker.pkg.dev/${PROJECT_ID}/messaging-${ENV}-dr-docker/${SERVICE}:${TAG}"

echo "→ Copy ${PRIMARY}"
echo "    → ${DR}"

gcloud auth configure-docker "${PRIMARY_REGION}-docker.pkg.dev,${DR_REGION}-docker.pkg.dev" --quiet

# gcrane est plus rapide et préserve le digest, mais on reste sur docker
docker pull "${PRIMARY}"
docker tag  "${PRIMARY}" "${DR}"
docker push "${DR}"

# Tag latest aussi
DR_LATEST="${DR_REGION}-docker.pkg.dev/${PROJECT_ID}/messaging-${ENV}-dr-docker/${SERVICE}:latest"
docker tag "${PRIMARY}" "${DR_LATEST}"
docker push "${DR_LATEST}"

echo "✅ Image disponible en DR : ${DR}"
