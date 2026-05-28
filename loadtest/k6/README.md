# Load tests k6

Tests de charge pour valider que la messagerie tient ses SLO en production-like.

## Scénarios

| Scénario | Fichier | But |
|---|---|---|
| `http-baseline` | `http-baseline.js` | Charge baseline : login + list conversations + send message (50→200 VU) |
| `messages-burst` | `messages-burst.js` | Pic ponctuel : 500 VU/30s, envoi simultané |
| `ws-fanout` | `ws-fanout.js` | 200 sockets WebSocket connectés en parallèle, mesure latence message→event |
| `mixed` | `mixed.js` | Combine HTTP + WS, profil "réaliste" 1h |

## Prérequis

- [k6](https://k6.io/docs/get-started/installation/) installé
- API accessible (staging conseillé)
- Comptes seed : 50 couples customer+seller préprovisionnés via `seed-loadtest.ts` (cf. `backend/src/database/seed-loadtest.ts` — à scripter pour > 100 users)

## Exécution

```bash
# baseline
k6 run -e BASE_URL=https://staging.api.example.com -e VUS=100 -e DURATION=2m \
       loadtest/k6/http-baseline.js

# avec rapport HTML
k6 run --out json=result.json loadtest/k6/http-baseline.js
k6 html-report result.json > report.html
```

## SLO cibles

| Métrique | Cible |
|---|---|
| `http_req_duration{p(95)}` | < 500 ms |
| `http_req_duration{p(99)}` | < 1500 ms |
| `http_req_failed` | < 1 % |
| `ws_message_latency_ms{p(95)}` | < 300 ms |
| `iteration_duration{p(95)}` | < 1 s |

## Checklist avant load test prod

- [ ] WAF rate limit ajusté pour les IPs k6 (ou allowlist temporaire)
- [ ] Alarmes désactivées sur la fenêtre
- [ ] Coût estimé (ALB requêtes + Fargate scaling)
- [ ] Comm équipe ops
