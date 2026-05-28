/**
 * 200 WebSockets connectés. Pour chaque conv :
 *   - 1 customer envoie via HTTP
 *   - 1 seller écoute via WS et mesure le temps de propagation
 */
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const WS_URL = (__ENV.BASE_URL || 'http://localhost:3000')
  .replace(/^http/, 'ws') + '/ws/?EIO=4&transport=websocket';

export const options = {
  vus: 200,
  duration: '2m',
  thresholds: {
    ws_message_latency_ms: ['p(95)<300', 'p(99)<800'],
  },
};

const wsLatency = new Trend('ws_message_latency_ms');

export default function () {
  const i = __VU - 1;
  const role = i % 2 === 0 ? 'customer' : 'seller';
  const pair = Math.floor(i / 2);
  const email = `loadtest_${role}_${pair}@test.com`;

  const login = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ email, password: 'Password1234!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (login.status !== 200) return;
  const token = login.json('accessToken');

  const list = http.get(`${BASE}/api/v1/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const convs = list.json();
  if (!Array.isArray(convs) || !convs.length) return;
  const convId = convs[0].id;

  ws.connect(WS_URL, { headers: { Origin: BASE } }, (socket) => {
    // socket.io v4 protocol handshake : "0" puis namespace
    socket.on('open', () => {
      // payload simplifié pour démo ; en pratique utiliser socket.io-client-side
      socket.send(`40/ws,{"token":"${token}"}`);
    });

    socket.on('message', (msg) => {
      if (role === 'seller' && msg.includes('"message.created"')) {
        const sentAtMatch = msg.match(/"k6_sent":(\d+)/);
        if (sentAtMatch) {
          wsLatency.add(Date.now() - Number(sentAtMatch[1]));
        }
      }
    });

    if (role === 'customer') {
      sleep(2); // laisser le seller s'enregistrer
      for (let n = 0; n < 5; n++) {
        const idem = `ws-${pair}-${n}-${Date.now()}`;
        http.post(
          `${BASE}/api/v1/conversations/${convId}/messages`,
          JSON.stringify({ body: `ping {"k6_sent":${Date.now()}}` }),
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': idem,
            },
          },
        );
        sleep(1);
      }
    } else {
      sleep(20);
    }

    socket.close();
  });
}
