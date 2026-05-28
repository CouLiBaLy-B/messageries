import Redis from 'ioredis';

export class RedisRateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly limitPerMinute = 120,
  ) {}

  async check(userId: string): Promise<boolean> {
    const key = `ws_rl:${userId}:${Math.floor(Date.now() / 60_000)}`;
    const c = await this.redis.incr(key);
    if (c === 1) await this.redis.expire(key, 65);
    return c <= this.limitPerMinute;
  }
}
