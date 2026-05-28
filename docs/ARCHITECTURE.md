# Architecture — Messagerie E-commerce

## 1. Vue d'ensemble

```
┌──────────────┐      HTTPS/WSS      ┌──────────────────────────────┐
│  Client Web  │ ──────────────────▶ │   CDN + WAF + Rate limiting  │
│ (frontend-   │                     └──────────────┬───────────────┘
│  demo / app) │                                    │
└──────────────┘                                    ▼
                                       ┌────────────────────────────┐
                                       │   NestJS Backend           │
                                       │   ┌──────────────────────┐ │
                                       │   │ HTTP API (REST)      │ │
                                       │   ├──────────────────────┤ │
                                       │   │ WebSocket Gateway    │ │
                                       │   │ (Socket.IO + adapter)│ │
                                       │   └──────────┬───────────┘ │
                                       └──────┬───────┼─────────────┘
                                              │       │
                            ┌─────────────────┼───────┴─────────────────┐
                            ▼                 ▼                         ▼
                  ┌──────────────────┐  ┌────────────┐         ┌──────────────────┐
                  │  PostgreSQL      │  │  Redis     │         │ S3 / MinIO       │
                  │  (source of      │  │  (pub/sub  │         │ (attachments,    │
                  │   truth)         │  │   présence)│         │  privé, KMS)     │
                  └──────────────────┘  └────────────┘         └──────────────────┘
                            │                                         │
                            ▼                                         ▼
                  ┌──────────────────┐                       ┌──────────────────┐
                  │ Outbox + Workers │                       │ ClamAV / Sandbox │
                  │ - notifications  │                       │ scan antivirus   │
                  │ - indexation     │                       └──────────────────┘
                  │ - scan jobs      │
                  └──────────────────┘
```

## 2. Modèle de données (résumé)

| Table | Rôle |
|---|---|
| `users` | clients, vendeurs, support, admin |
| `orders` | référentiel local minimal (sync depuis e-commerce) |
| `conversations` | **1 par `order_id`** (unique) |
| `conversation_participants` | qui peut accéder (customer/seller/support) |
| `messages` | corps + sequence + idempotency_key |
| `message_receipts` | delivered_at / read_at par destinataire |
| `attachments` | objet S3 + scan_status + sha256 |
| `message_events_outbox` | événements pour workers (at-least-once) |
| `audit_log` | actions sensibles |

Contrainte forte : `UNIQUE(order_id)` sur `conversations` → 1 seule conversation par commande.

## 3. Flux d'envoi d'un message

```
1. POST /conversations/by-order/:orderId/messages
   Headers: Authorization: Bearer <JWT>, Idempotency-Key: <uuid>
2. AuthGuard           → JWT valide
3. OrderAccessGuard    → user est participant de la conversation liée à l'order
4. ValidationPipe      → body conforme (DTO + class-validator)
5. RateLimit (Redis)   → user + conversation
6. Service.sendMessage :
   BEGIN TX
     - SELECT FOR UPDATE conversation (lock pour sequence)
     - INSERT messages (sequence = MAX+1, idempotency_key UNIQUE)
     - INSERT receipts pour chaque participant
     - INSERT outbox event "message.created"
   COMMIT
7. RealtimeService.publish via Redis Pub/Sub
8. WS Gateway → push aux sockets des participants
9. Worker outbox → notifications email/push si offline
10. Client ACK delivered/read → POST /messages/:id/read
```

## 4. Sécurité WebSocket

- handshake authentifié par JWT (cookie HttpOnly ou header)
- `Origin` vérifié contre allowlist
- `maxHttpBufferSize` strict (ex: 64 KB)
- rate limit par socket via Redis
- chaque event entrant validé (Joi / class-validator)
- `join_conversation` → re-vérifie l'autorisation côté serveur
- jamais de diffusion sans contrôle de la room

## 5. Idempotence & ordre

- `messages.sequence` : entier monotone **par conversation**, généré sous lock (`SELECT ... FOR UPDATE`).
- `messages.idempotency_key` : `UNIQUE(conversation_id, sender_id, idempotency_key)` — replay côté client renvoie le message existant.
- pagination "cursor" via `after_sequence` / `before_sequence`.

## 6. Pièces jointes

```
1. POST /attachments/presign  → URL d'upload signée (S3 PutObject, 5min)
2. Client upload direct vers S3 privé
3. POST /attachments/finalize → crée attachment status=pending, enqueue scan
4. Worker ClamAV scan le fichier
5. Status → clean | infected | failed
6. Lien dans message validé seulement si scan_status=clean
7. GET /attachments/:id/download-url → URL signée GET (60s) + RBAC
```

## 7. Environnements

| Env | URL | DB | Stockage |
|---|---|---|---|
| dev | localhost | postgres docker | MinIO docker |
| staging | staging.api.example.com | RDS small | S3 bucket staging |
| prod | api.example.com | RDS multi-AZ | S3 + lifecycle + KMS |

## 8. Phases

- **Phase 1 (ce repo)** : MVP texte + WS + attachments + audit + rate limit + docker compose.
- **Phase 2** : chiffrement enveloppe au repos (KMS), modération, notifications, outbox worker dédié.
- **Phase 3** : WS gateway séparé, queue durable (NATS JetStream), recherche OpenSearch, multi-région.
