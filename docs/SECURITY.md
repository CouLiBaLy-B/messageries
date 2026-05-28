# Sécurité — Threat Model & Contrôles

## 1. Threat Model (STRIDE résumé)

| Menace | Exemple | Mitigation |
|---|---|---|
| **S**poofing | Vol de JWT | Cookies HttpOnly+Secure+SameSite, expiration courte, refresh rotatif, MFA admin |
| **T**ampering | Modification d'un message d'un tiers | Autorisation objet sur chaque endpoint, audit log |
| **R**epudiation | Vendeur nie avoir envoyé un message | `messages.sender_id` + `audit_log` immuable + receipts |
| **I**nfo Disclosure | Vendeur A lit conversation vendeur B | `OrderAccessGuard` + RLS PostgreSQL (Phase 2) |
| **D**oS | Flood WebSocket | Rate limit Redis par user/IP, `maxHttpBufferSize`, WAF |
| **E**levation | Client devient admin | Rôles vérifiés serveur, jamais depuis le token sans signature, scope JWT |

## 2. IDOR — règle absolue

Tout endpoint reçoit un ID → le serveur **doit** appeler `assertCanAccess(user, resource)` avant toute opération. Implémenté via `OrderAccessGuard` et `ConversationAccessGuard`.

## 3. Authentification

- JWT signé HS256 (dev) → RS256 (prod, clé KMS).
- Stocké en cookie `HttpOnly; Secure; SameSite=Lax`.
- Refresh token rotatif, revocable (table `refresh_tokens` ou Redis).
- MFA TOTP obligatoire pour rôles `support` et `admin`.
- Bcrypt cost 12 ou Argon2id pour mots de passe.

## 4. Validation & XSS

- Messages stockés en **texte brut** (`body_format = 'plain_text'`).
- Encodage HTML à l'affichage côté client (jamais `innerHTML`).
- Si Markdown un jour : DOMPurify côté client + sanitizer côté serveur, allowlist stricte.

## 5. SQL injection

- TypeORM avec requêtes paramétrées uniquement.
- Aucun `query()` avec concaténation de strings.

## 6. CSRF

- JWT en cookie → token CSRF double-submit pour mutations.
- Ou : `Authorization: Bearer` (header custom) pour API pure → CSRF non applicable.

## 7. WebSocket

- `wss://` uniquement (TLS termination au LB).
- Vérification `Origin` contre `ALLOWED_ORIGINS`.
- Auth au handshake (`socket.handshake.auth.token` ou cookie).
- `maxHttpBufferSize: 65536`.
- Rate limit par socket via Redis (`socket_rl:<userId>`).
- Toute event entrante validée par DTO.
- `join` à une room conversation re-vérifie l'autorisation.

## 8. Pièces jointes

- Whitelist MIME : `image/jpeg, image/png, image/webp, application/pdf, text/plain`.
- Taille max : 10 MB.
- Re-vérification de la **signature magique** côté serveur (`file-type`).
- Stockage S3 privé, jamais public.
- URLs signées GET 60s + RBAC.
- Scan ClamAV → blocage si infected.
- Suppression métadonnées EXIF pour images (Phase 2).

## 9. Logs & audit

**À logger** : login, logout, échec auth, création conversation, accès support à une conversation tierce, download attachment, signalement, rate limit déclenché.

**À NE PAS logger** : corps de messages, tokens, cookies, URLs signées complètes, mots de passe, données carte.

## 10. Données sensibles e-commerce

- Détection regex (Phase 2) : PAN, CVV, IBAN dans les messages → masquage + flag.
- Bannière UI : "Ne partagez jamais vos coordonnées bancaires ici".
- Rétention : 24 mois après clôture conversation, puis anonymisation.
- Endpoints RGPD : `GET /me/data/export`, `DELETE /me/data` (Phase 2).

## 11. Secrets

- Aucun secret dans `.env` committé.
- Prod : AWS Secrets Manager / GCP Secret Manager / Azure Key Vault.
- Rotation 90j minimum.

## 12. Checklist avant prod

- [ ] Threat model relu
- [ ] Pentest externe
- [ ] DB privée (subnet privé)
- [ ] Redis privé + AUTH + TLS
- [ ] S3 bucket policy : `aws:SecureTransport=true`
- [ ] WAF activé (OWASP CRS)
- [ ] CloudWatch / Sentry alertes
- [ ] Backups testés (restauration mensuelle)
- [ ] Pas de tokens en `localStorage`
- [ ] HSTS + TLS 1.2+ uniquement
- [ ] CI : SAST (CodeQL), `npm audit`, dependency scan
