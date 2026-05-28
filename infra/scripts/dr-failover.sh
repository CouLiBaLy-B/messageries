#!/usr/bin/env bash
set -euo pipefail

# Procédure DR : promote replica + scale ECS DR.
# Usage : ./dr-failover.sh

DR_REGION=${DR_REGION:-eu-west-1}
DR_DB=${DR_DB:-messaging-prod-dr-pg}
DR_CLUSTER=${DR_CLUSTER:-messaging-prod-dr}
DR_SERVICE=${DR_SERVICE:-messaging-prod-dr-api}

echo "🔴 DR FAILOVER STARTED at $(date -u)"

echo "→ 1. Promote RDS read replica ${DR_DB}"
aws rds promote-read-replica \
  --db-instance-identifier "${DR_DB}" \
  --backup-retention-period 14 \
  --region "${DR_REGION}"

echo "→ 2. Waiting for DB available..."
aws rds wait db-instance-available --db-instance-identifier "${DR_DB}" --region "${DR_REGION}"

echo "→ 3. Scale up ECS DR service"
aws ecs update-service \
  --cluster "${DR_CLUSTER}" \
  --service "${DR_SERVICE}" \
  --desired-count 3 \
  --region "${DR_REGION}"

aws ecs wait services-stable \
  --cluster "${DR_CLUSTER}" \
  --services "${DR_SERVICE}" \
  --region "${DR_REGION}"

echo "✅ DR active. Route 53 health check va basculer le trafic dans ~60s."
echo "⚠️  Procédure post-failover :"
echo "   - Vérifier l'app : curl https://api.example.com/api/v1/health"
echo "   - Stopper l'app primary si encore vivante"
echo "   - Reconfigurer la nouvelle DB primary comme source d'un nouveau replica"
