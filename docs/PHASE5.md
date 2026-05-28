# Phase 5 — Scale-out : WS Gateway dédié + NATS JetStream

## 🎯 Pourquoi

| Limite Phase 1-4 | Cause | Phase 5 |
|---|---|---|
| WS et HTTP couplés dans une même task ECS | scale ensemble alors que charges différentes | **2 services ECS** : `api` et `ws-gateway` |
| Redis Pub/Sub at-most-once | un consumer offline → events perdus | **NATS JetStream** : durable, replay, at-least-once |
| ALB sticky cookie pour WS | sticky imparfait, idle timeout 60-120s | **NLB** dédié WS (TCP, idle 350s, pas de sticky requis) |
| Diffusion couplée à la transaction | rollback DB ≠ rollback publish | Pattern **outbox → NATS** strict |

## 🏗️ Architecture cible

```
                Internet
                   │
       ┌───────────┼──────────────┐
       ▼                          ▼
  ┌────────┐                ┌────────┐
  │  ALB   │ HTTPS          │  NLB   │ TLS pass-through
  │ (API)  │                │  (WS)  │
  └───┬────┘                └────┬───┘
      │                          │
      ▼                          ▼
  ┌────────────┐           ┌─────────────┐
  │ ECS api    │           │ ECS         │
  │ (REST)     │           │ ws-gateway  │
  │  Nx tasks  │           │  Mx tasks   │
  └─────┬──────┘           └──────┬──────┘
        │                         │
        │   ┌──────────────────┐  │
        │   │  NATS JetStream  │◀─┘   consume "messaging.events.*"
        ├──▶│   (3 replicas)   │      stream MESSAGING_EVENTS, durable consumer ws-gw-<task>
        │   └──────────────────┘
        │              ▲
        │              │
        ▼              │ publish "messaging.events.<type>" (at-least-once)
  ┌────────────────────┴──┐
  │ PostgreSQL + outbox   │
  │  - worker outbox SQL  │
  │  - lit outbox, pub    │
  │    sur NATS, marque   │
  │    processed_at       │
  └───────────────────────┘
```

## 🧩 Découpage du repo

```
messagerie/
├── backend/                 # API REST (HTTP only)
│   └── src/modules/         # plus de RealtimeGateway @WebSocketGateway
│       ├── outbox/          # worker publie maintenant sur NATS
│       └── nats/            # 🆕 client NATS partagé
│
├── ws-gateway/              # 🆕 nouveau service Node
│   ├── src/
│   │   ├── server.ts        # bootstrap Socket.IO + NATS consumer
│   │   ├── auth.ts          # vérif JWT (même secret que api)
│   │   ├── nats-consumer.ts # pull subscribe sur stream MESSAGING_EVENTS
│   │   └── fanout.ts        # route event → room socket.io
│   ├── Dockerfile
│   └── package.json
│
└── infra/terraform/modules/
    ├── ws-gateway/          # 🆕 ECS service + NLB
    └── nats/                # 🆕 NATS JetStream sur Fargate (3 replicas, EFS storage)
```

## 🔄 Flux send-message (nouveau)

```
1. POST /conversations/:id/messages → api
2. TX BEGIN
   - INSERT messages (sequence, body, ...)
   - INSERT outbox (event_type='message.created', payload)
3. TX COMMIT
4. Worker outbox (api ou worker dédié) :
   - SELECT ... FOR UPDATE SKIP LOCKED
   - Publish NATS subject "messaging.events.message.created" avec Msg-Id = outbox.id
     (déduplication serveur JetStream)
   - UPDATE outbox SET processed_at = now()
5. ws-gateway (durable consumer "ws-gw") :
   - JetStream push/pull → receive event
   - lookup participants (cache local ou call API ws.routing)
   - emit to socket.io rooms "conv:<id>"
   - ack message
```

## 🔐 Sécurité conservée

- JWT vérifié au handshake WS (même `JWT_SECRET` partagé via Secrets Manager)
- Origin allowlist
- Rate limit par socket (Redis encore présent, ou stocké dans ws-gateway local cache)
- Aucun event NATS ne contient de PII chiffrée — juste IDs + sequence, le ws-gateway ne déchiffre pas (sauf si besoin de pousser le body au client → décision : on pousse uniquement `{id, conversationId, senderId, sequence, createdAt}` et le client fait un `GET` pour récupérer le body déjà déchiffré par api)

> ⚠️ Décision : pour éviter la latence d'un round-trip, l'api peut **publier directement le body déchiffré dans NATS** (NATS chiffré TLS + ACL). Sinon, version "stricte" : NATS ne contient que des IDs.

## 📊 Garanties

| Propriété | Avant | Phase 5 |
|---|---|---|
| Livraison event | at-most-once (Redis Pub/Sub) | at-least-once (NATS ack) |
| Replay possible | non | oui (stream history) |
| Durable | non | oui (storage file, replication 3) |
| Dédup | aucune | Msg-Id JetStream (window 2 min) |
| Ordered par conv | best-effort | strict (1 partition par subject, ou per-conv subject) |

## 🚦 Quand utiliser

Phase 5 est rentable à partir de :
- **> 10k sockets concurrents** (le HTTP n'a pas besoin de scaler à la même vitesse)
- ou **besoin de replay** des events (debug, recovery après bug)
- ou **> 1 instance api ET ws** (Redis Pub/Sub commence à être limitant)

En dessous, l'archi Phase 4 suffit largement.
