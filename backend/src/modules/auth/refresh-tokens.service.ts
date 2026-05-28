import { ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { RefreshToken } from './entities/refresh-token.entity';
import { MetricsService } from '../observability/metrics.service';

@Injectable()
export class RefreshTokensService {
  private readonly logger = new Logger(RefreshTokensService.name);
  private readonly ttlSec: number;

  constructor(
    @InjectRepository(RefreshToken) private readonly repo: Repository<RefreshToken>,
    cfg: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.ttlSec = cfg.get<number>('JWT_REFRESH_TTL', 2592000);
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(input: { userId: string; parentId?: string; userAgent?: string; ip?: string }) {
    const raw = randomBytes(48).toString('base64url');
    const tokenHash = this.hash(raw);
    const expires = new Date(Date.now() + this.ttlSec * 1000);
    await this.repo.save(
      this.repo.create({
        userId: input.userId,
        tokenHash,
        parentId: input.parentId ?? null,
        userAgent: input.userAgent,
        ip: input.ip,
        expiresAt: expires,
      }),
    );
    return { token: raw, expiresAt: expires };
  }

  async rotate(input: { token: string; userAgent?: string; ip?: string }) {
    const tokenHash = this.hash(input.token);
    const found = await this.repo.findOne({ where: { tokenHash } });
    if (!found) throw new ForbiddenException('Refresh token invalide');

    if (found.revokedAt) {
      // 🚨 token déjà révoqué utilisé → vol présumé
      this.logger.warn(`Refresh token replay detected user=${found.userId}`);
      this.metrics?.count('RefreshTokenReplayDetected', 1);
      await this.repo
        .createQueryBuilder()
        .update(RefreshToken)
        .set({ revokedAt: new Date(), revokedReason: 'family_compromise' })
        .where('user_id = :u AND revoked_at IS NULL', { u: found.userId })
        .execute();
      throw new ForbiddenException('Session compromise — reconnexion requise');
    }

    if (found.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException('Refresh token expiré');
    }

    found.revokedAt = new Date();
    found.revokedReason = 'rotated';
    await this.repo.save(found);
    this.metrics?.count('RefreshTokenRotated', 1);

    const next = await this.issue({
      userId: found.userId,
      parentId: found.id,
      userAgent: input.userAgent,
      ip: input.ip,
    });
    return { userId: found.userId, ...next };
  }

  async revokeAllForUser(userId: string, reason = 'logout') {
    await this.repo
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where('user_id = :u AND revoked_at IS NULL', { u: userId })
      .execute();
  }

  async revoke(token: string, reason = 'logout') {
    const tokenHash = this.hash(token);
    await this.repo
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where('token_hash = :h AND revoked_at IS NULL', { h: tokenHash })
      .execute();
  }
}
