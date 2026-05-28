import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class PresenceService implements OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private readonly redis: Redis;
  private readonly ttl = 60;

  constructor(cfg: ConfigService) {
    const host = cfg.get<string>('REDIS_HOST')!;
    const tls = cfg.get<boolean>('REDIS_TLS', false);
    const opts: RedisOptions = {
      host,
      port: cfg.get<number>('REDIS_PORT', 6379),
      password: cfg.get<string>('REDIS_PASSWORD') || undefined,
      tls: tls ? { servername: host } : undefined,
    };
    this.redis = new Redis(opts);
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  private key(userId: string) {
    return `presence:user:${userId}`;
  }

  async connect(userId: string, socketId: string) {
    const k = this.key(userId);
    await this.redis.multi().sadd(k, socketId).expire(k, this.ttl).exec();
  }

  async heartbeat(userId: string) {
    await this.redis.expire(this.key(userId), this.ttl);
  }

  async disconnect(userId: string, socketId: string) {
    const k = this.key(userId);
    const tx = this.redis.multi().srem(k, socketId);
    tx.scard(k);
    const res = (await tx.exec()) as any[];
    const remaining = res?.[1]?.[1] ?? 0;
    if (remaining === 0) await this.redis.del(k);
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.exists(this.key(userId))) === 1;
  }

  async areOnline(userIds: string[]): Promise<Record<string, boolean>> {
    if (userIds.length === 0) return {};
    const pipeline = this.redis.pipeline();
    userIds.forEach((u) => pipeline.exists(this.key(u)));
    const results = (await pipeline.exec()) ?? [];
    const out: Record<string, boolean> = {};
    userIds.forEach((u, i) => {
      out[u] = (results[i]?.[1] as number) === 1;
    });
    return out;
  }
}
