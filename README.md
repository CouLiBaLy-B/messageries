# 🛒 Messagerie E-commerce — Conversation par Commande

Système de messagerie custom sécurisée pour e-commerce, où **chaque conversation est liée à une commande**.

**Stack** : NestJS · PostgreSQL · Redis · S3 · Socket.IO · Docker · Terraform AWS · OpenTelemetry · k6.

---

## ✅ Phase 1 — MVP sécurisé
Auth JWT, guards anti-IDOR, 1 conv = 1 order (`UNIQUE`), sequence sous lock, idempotency, WS sécurisé, attachments S3, audit, throttling, docker-compose.

## ✅ Phase 2 — Production code
Envelope encryption AES-256-GCM, scan PAN/IBAN/CVV, outbox worker durable, notifications email throttlées, présence Redis, modération, refresh tokens rotatifs, RGPD export/anonymisation.

## ✅ Phase 3 — Production infra
Terraform AWS complet (VPC 3 AZ, RDS Multi-AZ, ElastiCache TLS, S3 KMS, ECS Fargate ARM64, ALB+WAF, KMS séparées), métriques CloudWatch + alarmes SNS, dashboard, GitHub Actions OIDC.

## ✅ Phase 4 — Tests, Observabilité, Load (LIVRÉ)
- 🧪 **Testcontainers e2e** : 7 specs (lifecycle, IDOR, refresh replay, attachments, WS, RGPD, **concurrence**)
- 🔭 **OpenTelemetry** : auto-instrumentation HTTP/PG/Redis/WS + X-Ray + sidecar ADOT
- 📊 **Pino structuré JSON** : redaction + corrélation `traceId/spanId`
- ⚡ **k6 load tests** : 4 scénarios + SLO thresholds
- 🚀 **CI étendue** : unit + e2e + audit + CodeQL + workflow load test manuel

## 📁 Structure

```
messagerie/
├── backend/
│   ├── src/
│   │   ├── observability-bootstrap.ts     # 🆕 OTel SDK init
│   │   ├── common/
│   │   │   ├── logging/pino-logger.ts     # 🆕 JSON + traceId
│   │   │   └── middleware/request-context.middleware.ts
│   │   └── modules/
│   │       ├── observability/             # 🆕 tracing + metrics
│   │       ├── auth/                      # JWT + refresh rotation
│   │       ├── conversations/             # 1 par order
│   │       ├── messages/                  # tx + sequence + crypto
│   │       ├── attachments/, realtime/, crypto/, moderation/,
│   │       └── outbox/, notifications/, presence/, privacy/, ...
│   ├── test/
│   │   ├── helpers/                       # 🆕 Testcontainers + app + fixtures
│   │   ├── e2e/                           # 🆕 7 specs
│   │   └── jest-e2e.json
│   └── Dockerfile (multi-stage ARM64)
│
├── infra/
│   ├── terraform/
│   │   ├── modules/
│   │   │   ├── ecs/                       # 🆕 sidecar aws-otel-collector
│   │   │   └── iam/                       # 🆕 X-Ray perms
│   │   └── envs/{staging,prod}/
│   └── scripts/
│
├── loadtest/
│   └── k6/                                # 🆕 4 scénarios
│
├── frontend-demo/
├── docker-compose.yml
├── docs/
│   ├── ARCHITECTURE.md, SECURITY.md, API.md,
│   ├── PHASE2.md, PHASE3.md
│   └── PHASE4.md                          # 🆕
└── .github/workflows/
    ├── ci.yml                             # unit + e2e + audit + CodeQL
    ├── terraform.yml
    ├── deploy-staging.yml
    └── loadtest.yml                       # 🆕 dispatch manuel k6
```

## 🚀 Démarrage

- Local : [`QUICKSTART.md`](QUICKSTART.md)
- Cloud : [`docs/PHASE3.md`](docs/PHASE3.md)
- Tests & observabilité : [`docs/PHASE4.md`](docs/PHASE4.md)

## 🎯 SLO production validés

| Métrique | Cible | Validation |
|---|---|---|
| `http_req_duration{p(95)}` | < 500 ms | k6 baseline |
| `http_req_duration{p(99)}` | < 1.5 s | k6 baseline |
| `http_req_failed` | < 1 % | k6 + alarm ALB 5xx |
| `ws_message_latency_ms{p(95)}` | < 300 ms | k6 ws-fanout |
| `OutboxLagSeconds` | < 60 s | CloudWatch alarm |
| `RefreshTokenReplayDetected` | == 0 | CloudWatch alarm critique |

## 🗺️ Phases ultérieures possibles

- **Phase 5 — Scale-out** : WebSocket gateway en process dédié + queue durable NATS JetStream à la place de l'outbox DB
- **Phase 6 — Recherche** : OpenSearch chiffré (avec workflow d'indexation respectant le chiffrement applicatif)
- **Phase 7 — Multi-région** : DR plan + read replica RDS cross-region + S3 CRR + Route 53 failover
- **Phase 8 — E2EE optionnel** : MLS (RFC 9420) pour les conversations vendeur↔client sensibles (incompatible support, à arbitrer)
