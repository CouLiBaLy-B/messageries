# Phase 6 — Recherche OpenSearch (chiffrement préservé)

## 🎯 Approche

L'envelope encryption Phase 2 chiffre les messages au repos. Indexer le contenu déchiffré dans OpenSearch crée une **deuxième source de données sensibles** → on durcit le périmètre :

| Choix | Pourquoi |
|---|---|
| **Opt-in par conversation** (`search_indexed` flag) | Consentement explicite, fuite limitée au consenti |
| **Index dans VPC privé** | Aucune IP publique, SG strict |
| **Chiffrement KMS** at-rest + node-to-node + HTTPS-only | Égalité avec RDS/Redis |
| **Filter participants:userId obligatoire** | RBAC enforced au niveau requête OS (pas qu'au niveau app) |
| **Audit logs OS** → CloudWatch | Trace des recherches |
| **Backfill async** à l'opt-in | UX non bloquante |
| **Suppression cascade** | Disable indexing OU anonymisation RGPD → `delete_by_query` |

## 📡 API

```http
POST   /api/v1/conversations/:id/search/enable   # opt-in + backfill
DELETE /api/v1/conversations/:id/search          # opt-out + delete
GET    /api/v1/search?q=...&conversationId=...   # search RBAC-filtré
```

Réponse `GET /search` :
```json
{
  "total": 12,
  "hits": [
    {
      "messageId": "uuid", "conversationId": "uuid",
      "sequence": "42", "createdAt": "...",
      "highlight": ["...<em>livraison</em>..."]
    }
  ]
}
```

## 🔄 Pipeline indexation

```
api send message
      │ TX commit (incl. outbox event "message.created")
      ▼
outbox worker
      ├─ NATS publish (Phase 5)
      └─ if conv.search_indexed → SearchService.indexMessageIfEnabled
                                  → OS.indexMessage (avec participants[])
```

À l'**enable**, backfill séquentiel des messages historiques. À la **désactivation** ou **anonymisation RGPD**, `delete_by_query` purge tout.

## 🛡️ Sécurité

- SG OpenSearch ingress 443 **uniquement depuis SG api**
- master user dans Secrets Manager (rotation 90j à scripter)
- TLS 1.2+ enforcé, KMS at-rest, audit logs activés
- **Aucune indexation sans `search_indexed=true`** en DB → impossible d'indexer "par erreur"
- Requête : `bool.filter = [{term: {participants: userId}}]` **obligatoire** côté `OpenSearchService.search()` → un user ne peut jamais lire les messages d'autrui même via OS

## 🚀 Activation

```bash
# 1. Provisionner le domain
cd infra/terraform/envs/staging
terraform apply -var='enable_phase6=true'

# 2. Config app
export SEARCH_ENABLED=true
export OPENSEARCH_ENDPOINT=https://...
# etc.
```

## 💸 Coût staging
- 2 × `t3.small.search` (20 GB gp3) ≈ **80 $/mois**
- Audit logs CW → quelques $

## ⚠️ Limites

- OS pas indexable si conv non opt-in → recherche limitée volontairement
- Si la conv est ré-indexée plus tard, le backfill peut être long → faire un job batch dédié pour > 10k messages
- En cas de leak OS : seuls les contenus des conversations indexées sont à risque ; tous les autres restent uniquement dans Postgres chiffré.
