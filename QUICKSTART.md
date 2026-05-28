# 🚀 Démarrage rapide

## Prérequis
- Docker + Docker Compose
- Node.js 20+

## 1. Stack locale

```bash
cd messagerie
docker compose up -d postgres redis minio minio-init
```

- PostgreSQL → `localhost:5432`
- Redis → `localhost:6379`
- MinIO console → http://localhost:9001 (`minio_admin` / `minio_admin_password`)

## 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run migration:run     # joue Phase 1 + Phase 2
npm run seed              # 3 users + 1 commande + 1 conversation
npm run start:dev
```

Le seed affiche un `orderId` à copier.

- API : http://localhost:3000/api/v1
- Swagger : http://localhost:3000/api/v1/docs

## 3. Frontend démo

`python3 -m http.server 8080 -d frontend-demo` puis http://localhost:8080.

- Connecte-toi `customer@test.com` / `Password1234!`
- Colle l'`orderId` → ouvre la conversation
- Envoie un message → reçu en temps réel par `seller@test.com` dans un autre navigateur
- Essaie d'envoyer "ma carte 4242 4242 4242 4242" → tu verras `[REDACTED_PAN]` et le badge ⚠ pan
- Clique "signaler" sur un message reçu → visible par admin via `/admin/reports`
- Clique "Export RGPD" → télécharge ton JSON

## 4. Tests

```bash
cd backend
npm test                  # unitaires (scanner, crypto)
npm run test:e2e          # e2e
```

## 5. Vérifier le chiffrement

```bash
# Connecte-toi à postgres
docker exec -it messagerie-postgres-1 psql -U messaging messaging

# Regarde un message : body est NULL, body_ciphertext contient des bytes
SELECT id, sequence, body, length(body_ciphertext), body_alg, body_dek_id
FROM messages ORDER BY created_at DESC LIMIT 1;
```

## 6. Comptes seed

| Email | Password | Role |
|---|---|---|
| `customer@test.com` | `Password1234!` | customer |
| `seller@test.com` | `Password1234!` | seller |
| `admin@test.com` | `Password1234!` | admin |

## 7. Reset

```bash
docker compose down -v
```

## 8. Désactiver le chiffrement (debug)

Mets `ENCRYPT_MESSAGE_BODY=false` dans `.env` → les messages seront stockés en clair (`body`). Utile pour debug uniquement.

## 9. Génération d'une nouvelle clé KMS

```bash
cd backend
npx ts-node scripts/gen-kms-key.ts key-v2
# → key-v2:<base64>
# Mets à jour KMS_LOCAL_KEYS et KMS_LOCAL_ACTIVE dans .env, restart.
```
