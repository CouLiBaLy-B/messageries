import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { RefreshTokensService } from './refresh-tokens.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: User['role'];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly refreshTokens: RefreshTokensService,
  ) {}

  async login(email: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const user = await this.users.findByEmail(email);
    if (!user || user.isSuspended || user.anonymizedAt) {
      throw new UnauthorizedException('Identifiants invalides');
    }
    const ok = await this.users.verifyPassword(user, password);
    if (!ok) throw new UnauthorizedException('Identifiants invalides');
    return this.issueSession(user, meta);
  }

  async issueSession(user: User, meta: { ip?: string; userAgent?: string }) {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwt.sign(payload, {
      expiresIn: this.cfg.get<number>('JWT_ACCESS_TTL'),
    });
    const refresh = await this.refreshTokens.issue({
      userId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return {
      accessToken,
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt,
      user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName },
    };
  }

  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }) {
    const rotated = await this.refreshTokens.rotate({
      token: refreshToken,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    const user = await this.users.findById(rotated.userId);
    if (!user || user.isSuspended || user.anonymizedAt) {
      throw new UnauthorizedException('Compte invalide');
    }
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwt.sign(payload, {
      expiresIn: this.cfg.get<number>('JWT_ACCESS_TTL'),
    });
    return {
      accessToken,
      refreshToken: rotated.token,
      refreshExpiresAt: rotated.expiresAt,
    };
  }

  async logout(refreshToken?: string, userId?: string) {
    if (refreshToken) await this.refreshTokens.revoke(refreshToken, 'logout');
    else if (userId) await this.refreshTokens.revokeAllForUser(userId, 'logout');
  }

  async verifyAccess(token: string): Promise<JwtPayload> {
    try {
      return await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token invalide');
    }
  }
}
