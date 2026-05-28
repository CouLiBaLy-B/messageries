# WS Gateway (Phase 5)

Service Node léger qui :

- expose Socket.IO sur `:3001` (HTTPS via NLB en prod)
- vérifie le JWT au handshake (même `JWT_SECRET` que l'API)
- consomme le stream NATS `MESSAGING_EVENTS` (durable `ws-gateway`)
- fait le fan-out vers les rooms `conv:<id>`

Pas de DB. Stateless. Scale horizontalement.

## Dev local

```bash
cp .env.example .env
npm i
npm run start:dev
```

Avec docker-compose : `docker compose up nats` puis `npm run start:dev`.

## Prod

Image ARM64, sidecar OTel optionnel (cf. Terraform). NLB devant (TLS pass-through ou termination LB).
