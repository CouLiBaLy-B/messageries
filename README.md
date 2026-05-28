# 🛒 Messagerie E-commerce — Conversation par Commande

Système de messagerie custom sécurisée pour e-commerce, où **chaque conversation est liée à une commande**.

**Stack** : NestJS · PostgreSQL · Redis · S3 · Socket.IO · NATS JetStream · Docker · Terraform AWS · OpenTelemetry · k6.

---

## ✅ Phases livrées

| Phase | Apport principal |
|---|---|
| **1 — MVP sécurisé** | Auth JWT, anti-IDOR, 1 conv = 1 order, sequence sous lock, idempotency, WS sécurisé, S3 attachments, audit, throttling |
| **2 — Production code** | Envelope encryption AES-256-GCM, scan PAN/IBAN/CVV, outbox worker, notifs email, présence Redis, modération, refresh tokens rotatifs, RGPD |
| **3 — Production infra** | Terraform AWS complet (VPC, RDS, ElastiCache, ECS, ALB, WAF, KMS, Secrets) + CloudWatch + GitHub Actions OIDC |
| **4 — Tests & observabilité** | Testcontainers e2e (7 specs), OpenTelemetry + X-Ray ADOT sidecar, Pino JSON + traceId, k6 load tests |
| **5 — Scale-out** | **WS Gateway dédié** (process séparé), **NATS JetStream** durable, NLB pour WebSocket, modules Terraform `nats/` + `ws-gateway/` |

## 📁 Structure (Phase 5)

```
messagerie/
├── backend/                          # API REST
│   └── src/modules/
│       ├── nats/                     # 🆕 client NATS partagé
│       ├── outbox/                   # publie maintenant sur NATS
│       └── realtime/                 # désactivé si WS_GATEWAY_DEDICATED=true
│
├── ws-gateway/                       # 🆕 service Node dédié
│   ├── src/
│   │   ├── server.ts                 # Socket.IO + NATS consumer
│   │   ├── auth.ts                   # JWT verify (jose, même secret que API)
│   │   ├── rate-limit.ts             # Redis rate limit par user
│   │   └── nats-consumer.ts          # JetStream pull subscriber
│   ├── Dockerfile (ARM64)
│   └── package.json
│
├── infra/terraform/modules/
│   ├── nats/                         # 🆕 cluster NATS 3 replicas (ECS+EFS+Cloud Map)
│   └── ws-gateway/                   # 🆕 ECS service + NLB TLS
│
├── docker-compose.yml                # ajout services nats + ws-gateway
├── docs/PHASE5.md                    # 🆕
└── ...
```

## 🔄 Flux Phase 5

```
client ──HTTP──▶ api (ECS)
                  │
                  ├─ TX: insert message + insert outbox event
                  ▼
            outbox worker
                  │ publish messaging.events.message.created
                  ▼
          NATS JetStream (durable, replicated, dedup Msg-Id)
                  │
                  ▼  (consumer durable "ws-gateway")
           ws-gateway (ECS)
                  │ fanout → socket.io rooms
                  ▼
              clients WebSocket
```

## 🚀 Démarrage local (avec Phase 5)

```bash
docker compose up -d postgres redis minio minio-init nats
cd backend && npm i && npm run migration:run && npm run seed && npm run start:dev &
cd ../ws-gateway && npm i && npm run start:dev
# Client : http://localhost:8080 — il pointe désormais vers ws://localhost:3001
```

> Côté frontend démo, change `WS_BASE = 'http://localhost:3001'`.

## 🚀 Déploiement AWS Phase 5

```bash
cd infra/terraform/envs/staging
terraform apply -var='enable_phase5=true'
# → crée: cluster NATS (3 replicas EFS), ECR ws-gateway, NLB+TG, ECS service ws-gateway
# → l'API reçoit NATS_ENABLED=true + WS_GATEWAY_DEDICATED=true
```

Côté DNS : pointer `api.example.com` → ALB, `ws.example.com` → NLB.

Voir [`docs/PHASE5.md`](docs/PHASE5.md) pour les détails, garanties, et quand Phase 5 vaut le coup.

## 🗺️ Phases ultérieures possibles

- **Phase 6** : Recherche OpenSearch (chiffrement préservé via indexation contrôlée)
- **Phase 7** : Multi-région DR (RDS cross-region, S3 CRR, Route 53 failover)
- **Phase 8** : E2EE optionnel (MLS RFC 9420) pour conversations sensibles
- **Phase 9** : Frontend React production + Playwright
