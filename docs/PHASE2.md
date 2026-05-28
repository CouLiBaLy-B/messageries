# Phase 2 — Production

## 🆕 Modules ajoutés

| Module | Rôle | Garanties |
|---|---|---|
| `crypto/` | Envelope encryption AES-256-GCM, KEK via KMS, DEK par message | AES-GCM (auth), rotation de KEK sans réencryption |
| `moderation/` | Détection PAN/IBAN/CVV/email/phone + report + admin | Redaction serveur AVANT chiffrement |
| `presence/` | Statut online/offline par user (Redis TTL) | Multi-socket, heartbeat 30s |
| `notifications/` | Email "nouveau message" pour offline uniquement | Dedup (UNIQUE), throttle 10min/conv/user |
| `outbox/` | Worker durable `SELECT FOR UPDATE SKIP LOCKED` | At-least-once, retry exponentiel cap 1h |
| `privacy/` | Export RGPD + anonymisation | Audit log, révocation refresh tokens |
| `auth/refresh-tokens` | Rotation + détection de replay | Famille révoquée si compromise |

## 🔐 Chiffrement enveloppe

```
┌────────────────────┐
│ plaintext message  │
└─────────┬──────────┘
          ▼
   ┌──────────────┐      ┌──────────────────────────┐
   │ DEK (256bit) │◀────▶│  KMS (LocalKms / AWS KMS)│
   │  aléatoire   │ wrap │  KEK active = key-v2     │
   └─────┬────────┘      └──────────────────────────┘
         │ AES-256-GCM
         ▼
┌─────────────────────────────────────┐
│ {ciphertext, iv, tag, dekId}         │  → stocké en bytea dans messages
│ dekId = "keyId::base64(wrappedDek)"  │
└─────────────────────────────────────┘
```

**Avantages** :
- Compromission DB seule → fichier ciphertext + DEK wrappée illisibles sans KEK KMS.
- Rotation de KEK : on change `KMS_LOCAL_ACTIVE`, les anciens messages restent lisibles car `dekId` contient le `keyId` historique.
- Suppression rapide d'un message → on supprime juste sa DEK (cryptoshredding).

**Limites** :
- Le serveur reste capable de déchiffrer (nécessaire pour support, modération, recherche).
- Pour E2EE vrai, voir `docs/ARCHITECTURE.md` § 1.

### Génération d'une clé KMS locale

```bash
cd backend
npx ts-node scripts/gen-kms-key.ts key-v2
# → key-v2:8b3J5p3xCq8mE+rNc7sV1WqA9oZqL6f0YtVjK2dGq5w=
```

Ajoute la ligne à `KMS_LOCAL_KEYS` (séparé par virgules) puis `KMS_LOCAL_ACTIVE=key-v2`.

## 🛡️ Détection données sensibles

Toute insertion de message passe par `ContentScannerService.scan()` :
- regex PAN + validation Luhn → `[REDACTED_PAN]`
- IBAN → `[REDACTED_IBAN]`
- CVV en contexte → `[REDACTED_CVV]`
- email, téléphone (anti-désintermédiation marketplace)

Les `flags` détectés sont stockés dans `messages.moderation_flags`. Score ≥ 0.6 → status `flagged` automatiquement.

## 📨 Outbox + notifications

Quand un message est créé, un `OutboxEvent` est inséré dans la **même transaction**. Le `OutboxWorker` :

1. tourne en boucle (intervalle adaptatif),
2. `SELECT ... FOR UPDATE SKIP LOCKED` → safe multi-instance,
3. invoque les handlers (`message.created` → notifications),
4. en cas d'erreur, retry exponentiel (`next_attempt_at`).

Le handler `message.created` :
- récupère les recipients ≠ sender,
- check **présence** Redis (`PresenceService.areOnline`),
- envoie email seulement aux **offline**,
- dedup par `(messageId, userId)` + throttle 10min par conversation.

## 🔄 Refresh token rotation

```
client login → access(15min) + refresh(30j, opaque, en DB hashé)
client refresh → ancien révoqué, nouveau émis avec parent_id
client utilise un refresh déjà révoqué → 🚨 toute la famille révoquée
```

Cf. OWASP "Refresh Token Rotation" → contre le vol de token persisté.

## 🔒 RGPD

| Endpoint | Action |
|---|---|
| `GET /me/data/export` | dump JSON (messages déchiffrés, conversations, attachments metadata) |
| `DELETE /me/data` | anonymise le user, wipe le body des messages, révoque sessions |
| `DELETE /admin/users/:id/data` | idem mais initié par admin (audit) |

**Compromis litiges e-commerce** : on n'efface pas les messages (preuves), on remplace leur corps par NULL et on supprime les DEKs (cryptoshredding) → impossible à déchiffrer, on garde l'historique des séquences pour les autres participants.

## 🚀 Migrer un environnement existant

```bash
cd backend
npm install
npm run migration:run    # joue Phase21717000000000
# Génère ta clé KMS prod :
openssl rand -base64 32
# Ajoute dans le secret manager :
#   KMS_LOCAL_KEYS=prod-v1:<base64>
#   KMS_LOCAL_ACTIVE=prod-v1
# (ou KMS_DRIVER=aws + AWS_KMS_KEY_ARN=...)
npm run start
```

⚠️ **Les messages déjà en base avant Phase 2 restent en clair** (colonne `body`). Le code lit indifféremment `body` ou les colonnes chiffrées. Pour migrer l'historique :

```sql
-- Script de migration (à scripter avec un job dédié, hors compose)
-- Pour chaque message avec body NOT NULL :
--   1. chiffrer body via crypto.encrypt
--   2. UPDATE messages SET body_ciphertext=..., body_iv=..., body=NULL
```

Un script Node `scripts/migrate-encrypt-history.ts` pourra être ajouté en Phase 3.

## ✅ Tests

```bash
cd backend
npm test                 # unitaires (scanner, crypto)
npm run test:e2e         # e2e (requiert docker up)
```

## 📊 Métriques recommandées (à brancher en Phase 3)

- `outbox.lag.seconds` (max `now() - created_at` non processé)
- `outbox.failures.total`
- `emails.sent.total{kind}`
- `messages.encrypted.total` vs `messages.plaintext.total`
- `presence.online.users`
- `auth.refresh.replay_detected.total` ← alerte sécurité critique
