import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'ws-gateway', env: process.env.NODE_ENV ?? 'development' },
  formatters: { level: (l: string) => ({ level: l }) },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
});
