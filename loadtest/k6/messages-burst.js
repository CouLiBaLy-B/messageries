import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 500,
      stages: [
        { duration: '15s', target: 100 },
        { duration: '30s', target: 300 },
        { duration: '15s', target: 100 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<800'],
  },
};

const USERS = Number(__ENV.USERS || 50);
let tokenCache = {};

export default function () {
  const i = __VU % USERS;
  const email = `loadtest_customer_${i}@test.com`;

  if (!tokenCache[email]) {
    const login = http.post(
      `${BASE}/api/v1/auth/login`,
      JSON.stringify({ email, password: 'Password1234!' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (login.status !== 200) return;
    tokenCache[email] = login.json('accessToken');
  }
  const token = tokenCache[email];
  const list = http.get(`${BASE}/api/v1/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const convs = list.json();
  if (!Array.isArray(convs) || !convs.length) return;
  const convId = convs[0].id;

  const idem = `burst-${__VU}-${__ITER}-${Date.now()}`;
  const res = http.post(
    `${BASE}/api/v1/conversations/${convId}/messages`,
    JSON.stringify({ body: `burst ${idem}` }),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idem,
      },
    },
  );
  check(res, { 'sent': (r) => r.status === 201 });
}
