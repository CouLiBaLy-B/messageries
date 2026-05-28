#!/usr/bin/env bash
set -euo pipefail

# Lance les migrations TypeORM en exécutant une task ECS one-shot.
# Usage : ./run-migrations.sh <env>

ENV=${1:?missing env}
REGION=${AWS_REGION:-eu-west-3}

cd "$(dirname "$0")/../terraform/envs/${ENV}"
CLUSTER=$(terraform output -raw ecs_cluster_name)
SERVICE=$(terraform output -raw ecs_service_name)

# Récup TaskDefinition courante du service
TASK_DEF=$(aws ecs describe-services --cluster "${CLUSTER}" --services "${SERVICE}" \
  --region "${REGION}" --query 'services[0].taskDefinition' --output text)

# Récup subnets + security group du service
NET=$(aws ecs describe-services --cluster "${CLUSTER}" --services "${SERVICE}" \
  --region "${REGION}" \
  --query 'services[0].networkConfiguration.awsvpcConfiguration' --output json)
SUBNETS=$(echo "$NET" | jq -r '.subnets | join(",")')
SGS=$(echo "$NET" | jq -r '.securityGroups | join(",")')

echo "→ Running migrations on ${CLUSTER} / ${TASK_DEF}"
TASK_ARN=$(aws ecs run-task --cluster "${CLUSTER}" \
  --task-definition "${TASK_DEF}" \
  --launch-type FARGATE \
  --region "${REGION}" \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SGS}],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"api","command":["sh","-c","npm run migration:run && echo DONE"]}]}' \
  --query 'tasks[0].taskArn' --output text)

echo "→ Task : ${TASK_ARN}"
echo "→ Waiting for completion..."
aws ecs wait tasks-stopped --cluster "${CLUSTER}" --tasks "${TASK_ARN}" --region "${REGION}"

EXIT_CODE=$(aws ecs describe-tasks --cluster "${CLUSTER}" --tasks "${TASK_ARN}" \
  --region "${REGION}" --query 'tasks[0].containers[0].exitCode' --output text)

echo "→ Exit code : ${EXIT_CODE}"
test "${EXIT_CODE}" = "0"
