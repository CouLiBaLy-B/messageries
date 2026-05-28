#!/usr/bin/env bash
set -euo pipefail

# Bootstrap S3 state bucket + DynamoDB lock table.
# Usage : ./bootstrap-state.sh <env> <region>
#   ex : ./bootstrap-state.sh staging eu-west-3

ENV=${1:?missing env}
REGION=${2:?missing region}

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="messaging-tfstate-${ACCOUNT_ID}-${ENV}"
TABLE="messaging-tflock-${ENV}"

echo "→ Bucket : ${BUCKET}"
echo "→ Table  : ${TABLE}"
echo "→ Région : ${REGION}"

# S3 state bucket
if aws s3api head-bucket --bucket "${BUCKET}" 2>/dev/null; then
  echo "✔ Bucket déjà existant"
else
  if [ "${REGION}" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "${BUCKET}" --region "${REGION}"
  else
    aws s3api create-bucket --bucket "${BUCKET}" --region "${REGION}" \
      --create-bucket-configuration LocationConstraint="${REGION}"
  fi
fi

aws s3api put-bucket-versioning --bucket "${BUCKET}" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "${BUCKET}" \
  --server-side-encryption-configuration '{
    "Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]
  }'
aws s3api put-public-access-block --bucket "${BUCKET}" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# DynamoDB lock table
if aws dynamodb describe-table --table-name "${TABLE}" --region "${REGION}" >/dev/null 2>&1; then
  echo "✔ Table déjà existante"
else
  aws dynamodb create-table \
    --table-name "${TABLE}" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "${REGION}"
fi

echo ""
echo "✅ Done. Renseigne dans envs/${ENV}/backend.tf :"
echo "   bucket = \"${BUCKET}\""
echo "   dynamodb_table = \"${TABLE}\""
