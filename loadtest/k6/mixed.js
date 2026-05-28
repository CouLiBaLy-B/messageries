import { group } from 'k6';
import baseline from './http-baseline.js';

export const options = {
  scenarios: {
    steady_http: {
      executor: 'constant-vus',
      vus: 80,
      duration: '10m',
      exec: 'http',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<700'],
  },
};

export function http() {
  group('http baseline', () => baseline());
}
