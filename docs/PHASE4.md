# Phase 4 — Tests, Observabilité avancée, Load testing

## 🎯 Objectifs

Rendre le système **vérifiable** et **observable** en prod :
- prouver que les garanties de sécurité tiennent (IDOR, idempotency, replay refresh, RGPD…)
- prouver que les performances tiennent la charge cible
- voir ce qui se passe à l'intérieur (traces distribuées + logs structurés + métriques business)

## 🆕 Ce qui a été ajouté

| Domaine | Fichiers | Apport |
|---|---|---|
| **Testcontainers e2e** | `backend/test/e2e/*.e2e-spec.ts`, `helpers/{containers,app,fixtures}.ts` | 6 specs couvrant lifecycle, IDOR, refresh replay, attachments S3, WS, RGPD, **concurrence** |
| **OpenTelemetry** | `src/observability-bootstrap.ts`, `tracing/tracing.service.ts` | Auto-instrumentation HTTP, Express, NestJS, PG, ioredis, socket.io + propagator X-Ray |
| **Pino structuré** | `common/logging/pino-logger.ts`, `middleware/request-context.middleware.ts` | JSON lines + redaction stricte + corrélation `traceId/spanId` |
| **ADOT sidecar** | `infra/terraform/modules/ecs/main.tf` | Conteneur `aws-otel-collector` dans la même task, exporte traces vers X-Ray |
| **k6 load tests** | `loadtest/k6/*.js`, `seed-loadtest.ts` | 4 scénarios (baseline, burst, ws-fanout, mixed) + seed 50 couples |
| **CI** | `.github/workflows/ci.yml`, `loadtest.yml` | Jobs unit + e2e (Testcontainers) + audit + CodeQL + dispatch k6 |

## 🧪 Tests e2e

### Exécuter

```bash
cd backend
npm ci
npm run test:e2e
```

Au démarrage, **Testcontainers** lance Postgres 16, Redis 7 et MinIO dans Docker. Les migrations TypeORM sont jouées automatiquement. Chaque spec a son propre setup (cf. `helpers/`).

### Couverture critique

| Spec | Vérifie |
|---|---|
| `messaging-full.e2e-spec.ts` | conversation unique par order, idempotency, sequence monotone, **chiffrement effectif en DB**, redaction PAN/IBAN/CVV |
| `idor.e2e-spec.ts` | un tiers ne lit/écrit pas, support rejoint + audité, 401 sans auth |
| `refresh-replay.e2e-spec.ts` | rotation OK, **replay → toute la famille révoquée** (réseau prouvé + DB inspectée) |
| `attachments.e2e-spec.ts` | presign → upload S3 → finalize → download URL, mimeType rejeté, RBAC sur download |
| `realtime.e2e-spec.ts` | WS reçoit `message.created` en temps réel, join refusé pour non-participant |
| `privacy.e2e-spec.ts` | export inclut messages déchiffrés, anonymisation wipe body + cryptoshredding + révocation tokens |
| `concurrency.e2e-spec.ts` | 50 envois concurrents → sequences uniques [1..50], 10 mêmes Idempotency-Key parallèles → 1 message |

### En CI

Job `e2e` dans `.github/workflows/ci.yml` : Docker dispo sur `ubuntu-latest`, donc Testcontainers fonctionne out-of-the-box. Durée ~3-5 min.

## 🔭 OpenTelemetry / X-Ray

### Activation

Côté backend :
```bash
TRACING_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
OTEL_SERVICE_NAME=messaging-api
```

Le fichier `src/observability-bootstrap.ts` est chargé **avant tout autre import** dans `main.ts`. Il auto-instrumente :
- entrées HTTP (Express)
- routes NestJS
- requêtes PostgreSQL (pg, avec `enhancedDatabaseReporting`)
- commandes Redis (ioredis)
- WebSocket events (socket.io)

### Spans custom

```ts
constructor(private readonly tracing: TracingService) {}

await this.tracing.span('messages.send', async () => { ... }, {
  conversationId,
  senderId,
});
```

### Logs corrélés

Chaque entry Pino contient `traceId` + `spanId` du contexte OTel actif → permet de cliquer depuis un trace X-Ray vers les logs CloudWatch correspondants.

### En prod (ECS)

Le module Terraform `ecs/` ajoute un **sidecar `aws-otel-collector`** dans la même task quand `tracing_enabled = true` :

```
┌─ ECS Task (Fargate) ──────────────────────────┐
│  ┌────────┐ OTLP HTTP   ┌──────────────────┐  │
│  │  api   │ ───4318───▶ │ aws-otel-collec. │──┼──▶ X-Ray
│  │ (Nest) │             │  (sidecar)       │  │    (PutTraceSegments)
│  └────────┘             └──────────────────┘  │
└────────────────────────────────────────────────┘
```

Pour l'activer en staging :
```bash
cd infra/terraform/envs/staging
terraform apply -var='tracing_enabled=true'
```

Permissions IAM X-Ray déjà incluses dans `task_role`.

## 📊 Logs structurés

Format Pino JSON :
```json
{
  "level": "info",
  "time": "2026-05-28T20:32:11.452Z",
  "service": "messaging-api",
  "env": "production",
  "version": "0.4.0",
  "traceId": "1-65f2a3b1-abc...",
  "spanId": "0a1b2c3d...",
  "reqId": "1f8e...",
  "method": "POST",
  "path": "/api/v1/conversations/.../messages",
  "status": 201,
  "durationMs": 87,
  "msg": "http.request"
}
```

CloudWatch Logs Insights :
```
fields @timestamp, status, durationMs, path, traceId
| filter status >= 500
| sort @timestamp desc
| limit 100
```

Redaction automatique :
- `authorization`, `cookie`, `password`, `passwordHash`, `token`, `refreshToken`, `accessToken`, `body_ciphertext` → `[REDACTED]`

## 🚀 Load tests k6

### Préparer

Sur staging, seed massif :
```bash
cd backend
npm run seed -- # pas suffisant
npx ts-node src/database/seed-loadtest.ts 100
```

### Lancer

```bash
k6 run \
  -e BASE_URL=https://staging.api.example.com \
  -e VUS=200 \
  -e DURATION=5m \
  loadtest/k6/http-baseline.js
```

Ou via GitHub Actions : *Actions → Load Test (manual) → Run workflow*.

### SLO cibles validées

| Métrique | Cible |
|---|---|
| `http_req_duration{p(95)}` | < 500 ms |
| `http_req_duration{p(99)}` | < 1.5 s |
| `http_req_failed` | < 1 % |
| `send_message_ms{p(95)}` | < 400 ms |
| `ws_message_latency_ms{p(95)}` | < 300 ms |

Si le seuil casse, k6 sort en code != 0 → la CI fail.

### Pendant un load test

À surveiller en parallèle :
- Dashboard CloudWatch `messaging-<env>-dashboard`
- ECS Service Events (autoscale up)
- RDS `DatabaseConnections` (doit rester sous max)
- `OutboxLagSeconds` (ne doit pas exploser)
- WAF `BlockedRequests` (rate limit attendu si on dépasse 2000/5min/IP)

## 🩺 Runbook étendu

### Latence p95 > 500 ms
1. Trace X-Ray → identifier le span le plus lent (DB ? Redis ? KMS ?)
2. Logs corrélés via `traceId`
3. Métrique `MessageSendDurationMs` par instance

### Outbox lag explose
1. `npm run start:dev` local + tracing → repérer l'event qui fail (instrumentation pg)
2. `SELECT event_type, count(*), max(attempts) FROM message_events_outbox WHERE processed_at IS NULL GROUP BY 1`
3. Si KMS : vérifier IAM + quota `kms:GenerateDataKey` (10k req/sec)

### Erreur 5xx en pic
1. CloudWatch Logs Insights `filter status >= 500 | stats count() by bin(1m)`
2. Joindre les `traceId` aux traces X-Ray
3. Vérifier ECS deployment circuit breaker (rollback auto si > 50% tasks fail)

## ✅ Validation Phase 4

- [x] Tests e2e couvrent les 7 chemins critiques
- [x] Test de concurrence (50 envois) prouve l'atomicité sequence + idempotency
- [x] Test de replay prouve la révocation famille
- [x] Test RGPD prouve cryptoshredding + révocation sessions
- [x] OTel auto-instrumenté HTTP/PG/Redis/WS
- [x] Logs JSON + redaction + corrélation traceId
- [x] ADOT sidecar Terraform (opt-in)
- [x] 4 scénarios k6 avec SLO thresholds
- [x] CI : unit + e2e Testcontainers + audit + CodeQL
- [x] Seed loadtest 50 couples
