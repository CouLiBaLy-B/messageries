import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis, { RedisOptions } from 'ioredis';
import { INestApplicationContext, Logger } from '@nestjs/common';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor!: ReturnType<typeof createAdapter>;
  private readonly logger = new Logger(RedisIoAdapter.name);

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(host: string, port: number, password?: string, tls = false): Promise<void> {
    const opts: RedisOptions = {
      host,
      port,
      password,
      lazyConnect: false,
      tls: tls ? { servername: host } : undefined,
      maxRetriesPerRequest: null, // requis par certains clients
    };
    const pubClient = new Redis(opts);
    const subClient = pubClient.duplicate();
    await Promise.all([
      new Promise<void>((res, rej) => {
        pubClient.once('ready', () => res());
        pubClient.once('error', rej);
      }),
      new Promise<void>((res, rej) => {
        subClient.once('ready', () => res());
        subClient.once('error', rej);
      }),
    ]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log(`✅ Socket.IO Redis adapter connecté (tls=${tls})`);
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: (origin: string, cb: any) => {
          if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
          return cb(new Error('Origin not allowed'), false);
        },
        credentials: true,
      },
      maxHttpBufferSize: 64 * 1024,
      pingTimeout: 30_000,
      pingInterval: 25_000,
      transports: ['websocket'],
    });
    server.adapter(this.adapterConstructor);
    return server;
  }
}
