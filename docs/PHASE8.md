# Phase 8 — E2EE optionnel (MLS RFC 9420)

## ⚠️ Avant-propos : compromis

E2EE = le serveur **ne peut plus lire** les messages.

| Feature | Impact E2EE |
|---|---|
| Recherche serveur (Phase 6) | ❌ impossible — indexation client-side seulement |
| Modération automatique (PAN/IBAN) | ❌ impossible côté serveur |
| Support direct (lecture conv) | ❌ impossible — fallback : signalement client-side avec décryption ciblée |
| RGPD export | ⚠️ uniquement les métadonnées + ciphertext opaque |
| Litiges commerciaux | ⚠️ preuves limitées au métadonnées |

→ **Réservé aux conversations sensibles**, opt-in explicite des participants. Pour 99% des cas e-commerce, l'envelope encryption Phase 2 suffit.

## 📐 Standard : MLS RFC 9420

[Messaging Layer Security](https://www.rfc-editor.org/rfc/rfc9420) — standard IETF, supporté par les clients matures. Avantages vs Signal :
- Groupes scalables (jusqu'à des milliers de membres)
- Forward secrecy + post-compromise security
- Architecture transport-agnostique (le serveur juste route)

## 🏗️ Rôle du backend

**Le backend ne fait AUCUNE crypto MLS.** Il sert uniquement :

1. **Pool de KeyPackages** : chaque client publie périodiquement des KP (clés publiques signées). Le pair les claim pour démarrer un groupe.
2. **Transport de MlsMessages opaques** : Welcome, Commit, Application, Proposal, GroupInfo.
3. **Persistance + sequencing** par groupe (epoch + sequence monotone).
4. **Audit** des opérations (enable, claims).

## 🗄️ Schéma DB

```
mls_key_packages
  - id, user_id, device_id, cipher_suite, key_package (bytea)
  - consumed_at, consumed_by, expires_at
  index : (user_id, expires_at) WHERE consumed_at IS NULL

mls_groups
  - id, conversation_id UNIQUE, group_id_mls (bytea), cipher_suite, epoch
  - 1 groupe par conversation

mls_messages
  - id, group_id, sender_user_id, sender_device_id
  - kind: welcome|commit|application|proposal|group_info
  - epoch, sequence (UNIQUE per group)
  - target_user_id (NULL = broadcast, sinon pickup ciblé)
  - ciphertext (bytea, opaque pour le serveur)

conversations.e2ee_enabled  (flag opt-in)
```

## 🔌 API

### KeyPackages
```http
POST /api/v1/e2ee/key-packages
  { deviceId, cipherSuite, keyPackages: ["base64", ...], ttlDays? }

GET  /api/v1/e2ee/key-packages/count?cipherSuite=...
  → 23   (stock disponible pour l'auto-republish)

POST /api/v1/e2ee/key-packages/claim/:targetUserId?cipherSuite=...
  → { keyPackageId, deviceId, keyPackage: "base64" }   (consume + lock)
```

### Activation E2EE pour une conversation
```http
POST /api/v1/conversations/:id/e2ee/enable
  {
    groupIdMls: "base64",
    cipherSuite: "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
    welcomeMessages: [
      { targetUserId, ciphertext: "base64", senderDeviceId }
    ]
  }
```

### Messages MLS
```http
POST /api/v1/conversations/:id/e2ee/messages
  { kind:"commit|application|...", epoch, ciphertext: "base64", senderDeviceId }

GET  /api/v1/conversations/:id/e2ee/messages?afterSequence=...
  → [{ id, kind, epoch, sequence, ciphertext, ... }]
```

⚠️ Sur conv `e2ee_enabled=true`, `POST /messages` (classique) **répond 403**.

## 🔐 Garanties

| | Phase 2 (envelope) | Phase 8 (E2EE) |
|---|---|---|
| Compromission DB | ciphertext illisible sans KMS | idem |
| Compromission DB + KMS | tout lisible | **toujours illisible** (clés privées clients) |
| Admin malveillant | peut lire (KMS access) | **ne peut pas lire** |
| Subpoena gouv | serveur peut être contraint de fournir le clair | **serveur ne peut pas** |
| Recherche serveur | possible | impossible |
| Forward secrecy | DEK rotation possible | natif (ratchet MLS) |

## 🚦 Workflow client-side typique

```
1. À l'inscription :
   client génère identityKey + 100 KeyPackages → POST /e2ee/key-packages

2. Quand stock < 20 :
   refresh automatique (POST plus de KP)

3. Activation E2EE conv :
   a. POST /e2ee/key-packages/claim/<participantId>?cipherSuite=...
   b. client crée localement le MlsGroup, ajoute le membre via Add Proposal + Commit
   c. génère Welcome opaque pour chaque participant
   d. POST /conversations/:id/e2ee/enable {welcomes}

4. Réception (autre device) :
   GET /e2ee/messages?afterSequence=last_seen
   → recoit son Welcome → joins group → decrypt applications

5. Envoi message :
   client encrypt Application Message
   POST /e2ee/messages {kind:'application', ciphertext}
```

## 🧪 Tests fournis

`test/e2e/e2ee.e2e-spec.ts` — vérifie le transport sans faire de vraie crypto :
- Publish/claim KP avec lock
- Enable E2EE + welcomes ciblés
- Refus du send classique
- Targeting : seul `target_user_id` voit son welcome

## 📚 Implémentation client recommandée

Côté client, utiliser une lib éprouvée (ne JAMAIS implémenter MLS soi-même) :
- **TypeScript/JS** : `mls-rs-wasm` (binding Rust de mls-rs)
- **Swift/Android** : `mls-rs` ou `OpenMLS`
- **Web** : WASM build de `OpenMLS` ou MLS-rs

## 💡 Quand l'activer

- Conversations sensibles (négociation B2B, RH, etc.)
- Régions à exigences strictes (RGPD avec analyse d'impact)
- Marchés segmentés "premium privacy"

**Pas** par défaut : trop coûteux côté UX et support pour l'usage e-commerce courant.

## 🚫 Hors scope (à venir si besoin)

- Multi-device : un user a plusieurs devices → chaque device a son identityKey, le client doit gérer le sync de groupes via Welcome ciblés
- Re-keying périodique (Commit régulier pour PCS)
- Quarantine : signaler un message → décryptage assisté par envoi consenti du contenu en clair par les participants
