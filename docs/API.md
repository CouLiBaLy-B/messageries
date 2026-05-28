# API Reference

Base URL : `http://localhost:3000/api/v1` (dev).
Auth : JWT en cookie `access_token` (HttpOnly) **ou** header `Authorization: Bearer <token>`.

## Auth

### `POST /auth/register`
```json
{ "email":"a@b.com", "password":"min 12 chars", "role":"customer|seller" }
```
→ `201` toujours (pas de leak d'existence).

### `POST /auth/login`
```json
{ "email":"...", "password":"..." }
```
→ `200` `{ user, accessToken }`. Cookies `access_token` + `refresh_token` posés.

### `POST /auth/refresh`
Lit le cookie `refresh_token` (ou `body.refreshToken`).
→ rotation : nouveau couple access+refresh. Si replay détecté → `403` + révocation famille.

### `POST /auth/logout`
→ `204`. Révoque le refresh + clear cookies.

## Orders (admin / webhook)

### `POST /orders` (admin)
```json
{ "externalRef":"...", "customerId":"<uuid>", "sellerId":"<uuid>", "totalCents":12990, "currency":"EUR" }
```

## Conversations

### `GET /conversations`
Liste les conversations de l'utilisateur courant.

### `POST /conversations/by-order/:orderId`
Crée ou récupère **la** conversation liée à `orderId` (UNIQUE).

### `GET /conversations/:conversationId`
→ détail + participants + `myRole`. Protégé par `ConversationAccessGuard`.

## Messages

### `POST /conversations/:cid/messages`
Headers: `Idempotency-Key: <uuid>`.
```json
{ "body":"Bonjour..." }
```
- Si le body contient PAN/IBAN/CVV/email/phone → **redaction serveur** + `moderationFlags`.
- Si chiffrement activé → corps chiffré (AES-256-GCM, DEK via KMS).
- → `201` `{ id, sequence, body (déchiffré pour la réponse), moderationFlags, ... }`.

### `GET /conversations/:cid/messages?afterSequence=&beforeSequence=&limit=50`
Pagination cursor. Body déchiffré côté serveur avant réponse.

### `POST /conversations/:cid/messages/read`
```json
{ "uptoSequence": "42" }
```

### `DELETE /conversations/:cid/messages/:messageId`
Soft-delete (auteur uniquement). DEK supprimée → cryptoshredding.

## Modération

### `POST /messages/:messageId/report`
```json
{ "reason":"spam|abuse|sensitive_data|other", "details":"..." }
```

### `GET /admin/reports` (support/admin)
Liste des reports `status=open`.

### `POST /admin/reports/:reportId/resolve` (support/admin)
```json
{ "action":"dismiss|hide_message" }
```

## Attachments

### `POST /attachments/presign`
```json
{ "conversationId":"<uuid>", "filename":"f.pdf", "mimeType":"application/pdf", "sizeBytes": 524288 }
```
→ `{ attachmentId, uploadUrl, objectKey, expiresIn:300 }`. Client `PUT` direct sur `uploadUrl`.

### `POST /attachments/:id/finalize`
### `GET /attachments/:id/download-url`

## RGPD

### `GET /me/data/export`
Export JSON de toutes les données personnelles + messages déchiffrés.

### `DELETE /me/data`
Anonymisation : email/displayName → `anon_<id>`, body messages → NULL, DEK supprimées, sessions révoquées.

### `DELETE /admin/users/:userId/data` (admin)
Anonymisation initiée par admin (audit log).

## WebSocket

Namespace : `/ws`. Transport : `websocket` uniquement.

### Events client → serveur
| Event | Payload | Ack |
|---|---|---|
| `conversation.join` | `{ conversationId }` | `{ ok, code? }` |
| `conversation.leave` | `{ conversationId }` | `{ ok }` |
| `typing` | `{ conversationId, isTyping }` | — |
| `presence.ping` | `{}` | `{ ok, ts }` |

### Events serveur → client
| Event | Payload |
|---|---|
| `message.created` | `{ id, conversationId, senderId, sequence, body (déchiffré), createdAt }` |
| `message.deleted` | `{ id, conversationId, sequence }` |
| `message.read` | `{ conversationId, userId, uptoSequence }` |
| `typing` | `{ conversationId, userId, isTyping }` |
| `error` | `{ code }` |

## Health

### `GET /health` → `{ status, db, uptime }`
