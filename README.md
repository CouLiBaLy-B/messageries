# 🛒 Messagerie E-commerce — Conversation par Commande

Système de messagerie custom sécurisée pour e-commerce, où **chaque conversation est liée à une commande**.

**Stack** : NestJS · PostgreSQL · Redis · S3 · Socket.IO · NATS JetStream · OpenSearch · MLS (RFC 9420) · Docker · Terraform AWS · OpenTelemetry · k6.

---

## ✅ Phases livrées

| Phase | Apport principal |
|---|---|
| **1 — MVP sécurisé** | Auth JWT (Argon2id), anti-IDOR, 1 conv = 1 order, sequence sous lock, idempotency, WS sécurisé, S3 attachments, audit, throttling |
| **2 — Production code** | Envelope encryption AES-256-GCM, scan PAN/IBAN/CVV, outbox worker, notifs email, présence Redis, modération, refresh tokens rotatifs, RGPD |
| **3 — Production infra** | Terraform AWS (VPC 3 AZ, RDS Multi-AZ, ElastiCache TLS, ECS Fargate ARM64, ALB+WAF, KMS) + CloudWatch + GitHub Actions OIDC |
| **4 — Tests & observabilité** | Testcontainers e2e (7 specs), OpenTelemetry + X-Ray ADOT sidecar, Pino JSON + traceId, k6 load tests |
| **5 — Scale-out** | WS Gateway dédié, NATS JetStream durable, NLB pour WebSocket |
| **6 — Recherche** | **OpenSearch opt-in** par conversation, RBAC enforced, KMS+VPC privé, backfill/cleanup |
| **7 — Multi-région DR** | RDS cross-region replica, S3 CRR RTC 15min, Route 53 failover, RPO ≤5min / RTO ≤15min |
| **8 — E2EE optionnel** | Backend MLS (RFC 9420) opt-in : KeyPackages pool, transport opaque Welcome/Commit/Application |

## 📁 Structure (à jour)

```
messagerie/
├── backend/
│   └── src/modules/
│       ├── auth/, users/, orders/, conversations/, messages/, attachments/,
│       ├── realtime/, audit/, health/,
│       ├── crypto/, moderation/, notifications/, presence/, outbox/, privacy/,
│       ├── observability/, nats/,
│       ├── search/                 # 🆕 Phase 6 — OpenSearch opt-in + RBAC
│       └── e2ee/                   # 🆕 Phase 8 — MLS transport (KeyPackages + groups + messages)
│
├── ws-gateway/                     # Phase 5
│
├── infra/terraform/
│   ├── modules/
│   │   ├── vpc, kms, secrets, s3, ecr, rds, redis, alb, waf, ecs, iam, observability,
│   │   ├── nats, ws-gateway,                       # Phase 5
│   │   ├── opensearch,                              # 🆕 Phase 6
│   │   ├── dr-rds-replica, dr-s3-replication,      # 🆕 Phase 7
│   │   └── dr-route53-failover                     # 🆕 Phase 7
│   └── envs/
│       ├── staging/   (opt-in enable_phase5/6 via tfvars)
│       ├── prod/
│       └── dr/                                     # 🆕 Phase 7
│
├── docker-compose.yml
├── docs/
│   ├── ARCHITECTURE.md, SECURITY.md, API.md,
│   ├── PHASE2.md, PHASE3.md, PHASE4.md, PHASE5.md,
│   ├── PHASE6.md, PHASE7.md, PHASE8.md             # 🆕
└── .github/workflows/...
```

## 🚀 Démarrage

- Local : [`QUICKSTART.md`](QUICKSTART.md)
- Cloud : [`docs/PHASE3.md`](docs/PHASE3.md)
- Scale-out : [`docs/PHASE5.md`](docs/PHASE5.md)
- Recherche : [`docs/PHASE6.md`](docs/PHASE6.md)
- DR : [`docs/PHASE7.md`](docs/PHASE7.md)
- E2EE : [`docs/PHASE8.md`](docs/PHASE8.md)

## 🎚️ Matrice features × confidentialité

|  | Pas chiffré | Envelope (Phase 2) | E2EE (Phase 8) |
|---|---|---|---|
| Recherche serveur | ✅ | ✅ (avec opt-in P6) | ❌ |
| Modération auto PAN/IBAN | ✅ | ✅ | ❌ |
| Support lit conv | ✅ | ✅ | ❌ |
| Compromission DB | 🔴 | 🟢 | 🟢 |
| Compromission DB+KMS | 🔴 | 🔴 | 🟢 |
| Admin malveillant lit | 🔴 | 🟠 (via KMS) | 🟢 |
| Subpoena force déchiffrement | 🔴 | 🔴 | 🟢 |

Par défaut : **Envelope (Phase 2) activé partout**, **E2EE opt-in** pour conversations sensibles.
