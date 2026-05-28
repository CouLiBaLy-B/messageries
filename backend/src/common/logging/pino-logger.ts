/**
 * Logger structuré JSON pour stdout (CloudWatch parse nativement).
 * - Inclut traceId + spanId si OTel est actif.
 * - Redaction stricte des champs sensibles.
 */

import { randomUUID } from 'crypto';

let pino: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  pino = require('pino');
} catch {
  pino = null;
}

function getOtelIds(): { traceId?: string; spanId?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const api = require('@opentelemetry/api');
    const span = api.trace?.getActiveSpan?.();
    const ctx = span?.spanContext?.();
    if (ctx?.traceId) return { traceId: ctx.traceId, spanId: ctx.spanId };
  } catch {
    /* no-op */
  }
  return {};
}

export const logger = pino
  ? pino({
      level: process.env.LOG_LEVEL ?? 'info',
      base: {
        service: 'messaging-api',
        env: process.env.NODE_ENV ?? 'development',
        version: process.env.APP_VERSION ?? '0.4.0',
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.passwordHash',
          '*.token',
          '*.refreshToken',
          '*.accessToken',
          '*.bodyCiphertext',
          '*.body_ciphertext',
        ],
        censor: '[REDACTED]',
      },
      mixin() {
        return getOtelIds();
      },
      formatters: {
        level: (label: string) => ({ level: label }),
      },
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
    })
  : {
      // fallback console JSON minimal
      info: (o: any, m?: string) =>
        console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), msg: m, ...(typeof o === 'string' ? { msg: o } : o), ...getOtelIds() })),
      warn: (o: any, m?: string) =>
        console.warn(JSON.stringify({ level: 'warn', time: new Date().toISOString(), msg: m, ...(typeof o === 'string' ? { msg: o } : o), ...getOtelIds() })),
      error: (o: any, m?: string) =>
        console.error(JSON.stringify({ level: 'error', time: new Date().toISOString(), msg: m, ...(typeof o === 'string' ? { msg: o } : o), ...getOtelIds() })),
      debug: () => {},
    };

export function requestId(): string {
  return randomUUID();
}
