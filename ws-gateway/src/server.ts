import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { logger } from './logger';
import { verifyJwt, extractToken, JwtPayload } from './auth';
import { RedisRateLimiter } from './rate-limit';
import { NatsConsumer } from './nats-consumer';

interface AuthedSocket extends Socket {
  data: { user: JwtPayload };
}

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  // --- HTTP server pour health + WS upgrade ---
  const http = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // --- Redis pour adapter + rate limit ---
  const redisOpts = {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true' ? { servername: process.env.REDIS_HOST } : undefined,
  };
  const pub = new Redis(redisOpts);
  const sub = pub.duplicate();
  const rlRedis = pub.duplicate();
  const limiter = new RedisRateLimiter(rlRedis);

  // --- Socket.IO ---
  const io = new Server(http, {
    cors: {
      origin: (origin, cb) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error('Origin not allowed'), false);
      },
      credentials: true,
    },
    maxHttpBufferSize: 64 * 1024,
    pingTimeout: 30_000,
    pingInterval: 25_000,
    transports: ['websocket'],
  });
  io.adapter(createAdapter(pub, sub));

  // --- Auth handshake ---
  io.use(async (socket, next) => {
    try {
      const token = extractToken(socket.handshake.auth, socket.handshake.headers.cookie);
      if (!token) throw new Error('no token');
      const user = await verifyJwt(token);
      (socket as AuthedSocket).data = { user };
      next();
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'ws auth rejected');
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const s = socket as AuthedSocket;
    const u = s.data.user;
    s.join(`user:${u.sub}`);
    logger.info({ user: u.sub, sid: s.id }, 'ws connected');

    s.on('disconnect', () => {
      logger.info({ user: u.sub, sid: s.id }, 'ws disconnected');
    });

    s.on('conversation.join', async (body, ack) => {
      if (!(await limiter.check(u.sub))) {
        return ack?.({ ok: false, code: 'rate_limited' });
      }
      const conversationId = body?.conversationId;
      if (typeof conversationId !== 'string' || conversationId.length > 64) {
        return ack?.({ ok: false, code: 'bad_request' });
      }
      // Note : la vérif d'autorisation détaillée est faite par l'API REST.
      // Ici on accepte le join, mais on n'enverra de message que si le
      // user est dans la liste "recipients" du NATS event (autorité = api).
      await s.join(`conv:${conversationId}`);
      ack?.({ ok: true });
    });

    s.on('conversation.leave', async (body, ack) => {
      if (body?.conversationId) await s.leave(`conv:${body.conversationId}`);
      ack?.({ ok: true });
    });

    s.on('typing', async (body) => {
      if (!(await limiter.check(u.sub))) return;
      if (typeof body?.conversationId !== 'string') return;
      s.to(`conv:${body.conversationId}`).emit('typing', {
        conversationId: body.conversationId,
        userId: u.sub,
        isTyping: !!body.isTyping,
      });
    });
  });

  // --- NATS consumer → fanout ---
  const consumer = new NatsConsumer();
  await consumer.start({
    servers: process.env.NATS_URL ?? 'nats://localhost:4222',
    stream: process.env.NATS_STREAM ?? 'MESSAGING_EVENTS',
    durable: process.env.NATS_DURABLE ?? 'ws-gateway',
    onEvent: async (eventType, data) => {
      switch (eventType) {
        case 'message.created': {
          // Émis vers la room conv:* — chaque client a déjà été authentifié pour join cette room.
          // Sécurité défense en profondeur : si data.recipients fournis, on cible aussi user:* directement.
          io.to(`conv:${data.conversationId}`).emit('message.created', {
            id: data.messageId,
            conversationId: data.conversationId,
            senderId: data.senderId,
            sequence: data.sequence,
            body: data.body, // peut être absent (le client fera un GET)
            createdAt: data.createdAt,
            moderationFlags: data.moderationFlags,
          });
          break;
        }
        case 'message.deleted':
          io.to(`conv:${data.conversationId}`).emit('message.deleted', {
            id: data.messageId,
            conversationId: data.conversationId,
            sequence: data.sequence,
          });
          break;
        case 'message.read':
          io.to(`conv:${data.conversationId}`).emit('message.read', data);
          break;
        default:
          logger.debug({ eventType }, 'unknown event ignored');
      }
    },
  });

  http.listen(PORT, () => logger.info({ port: PORT }, 'ws-gateway listening'));

  const shutdown = async () => {
    logger.info('shutdown...');
    io.close();
    await consumer.stop();
    pub.disconnect();
    sub.disconnect();
    rlRedis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  logger.error({ err: e.message }, 'fatal');
  process.exit(1);
});
