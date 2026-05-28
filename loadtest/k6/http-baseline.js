import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '1m';

// Comptes seed pré-créés. cf seed-loadtest.ts
// pattern : loadtest_customer_<i>@test.com / Password1234!
const USERS = Number(__ENV.USERS || 50);

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    'http_req_duration{op:send_message}': ['p(95)<400'],
  },
};

const sendDur = new Trend('send_message_ms');

export default function () {
  const i = (__VU + __ITER) % USERS;
  const email = `loadtest_customer_${i}@test.com`;

  // 1. login
  const login = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ email, password: 'Password1234!' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { op: 'login' } },
  );
  if (!check(login, { 'login ok': (r) => r.status === 200 })) {
    return;
  }
  const token = login.json('accessToken');
  const auth = { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };

  // 2. list conversations
  const list = http.get(`${BASE}/api/v1/conversations`, { ...auth, tags: { op: 'list_conv' } });
  check(list, { 'list ok': (r) => r.status === 200 });

  const convs = list.json();
  if (!Array.isArray(convs) || convs.length === 0) {
    return;
  }
  const convId = convs[0].id;

  // 3. send message
  const idem = `${__VU}-${__ITER}-${Date.now()}`;
  const t0 = Date.now();
  const sendRes = http.post(
    `${BASE}/api/v1/conversations/${convId}/messages`,
    JSON.stringify({ body: `k6 ${idem}` }),
    {
      headers: { ...auth.headers, 'Idempotency-Key': idem },
      tags: { op: 'send_message' },
    },
  );
  sendDur.add(Date.now() - t0);
  check(sendRes, { 'send 201': (r) => r.status === 201 });

  sleep(Math.random() * 1.5 + 0.5);
}
