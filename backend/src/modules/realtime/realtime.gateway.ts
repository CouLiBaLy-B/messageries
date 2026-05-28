import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AuthService, JwtPayload } from '../auth/auth.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PresenceService } from '../presence/presence.service';
import { roomForConversation, roomForUser } from './realtime.service';

interface AuthedSocket extends Socket {
  data: {
    user: JwtPayload;
    hbTimer?: NodeJS.Timeout;
  };
}

@WebSocketGateway({ namespace: '/ws' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly redis: Redis;
  private readonly wsLimit: number;

  constructor(
    private readonly auth: AuthService,
    private readonly conversations: ConversationsService,
    private readonly presence: PresenceService,
    private readonly cfg: ConfigService,
  ) {
    this.redis = new Redis({
      host: cfg.get<string>('REDIS_HOST'),
      port: cfg.get<number>('REDIS_PORT'),
      password: cfg.get<string>('REDIS_PASSWORD') || undefined,
    });
    this.wsLimit = cfg.get<number>('RATE_LIMIT_WS_EVENTS_PER_MINUTE', 120);
  }

  async handleConnection(client: AuthedSocket) {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('No token');
      const payload = await this.auth.verifyAccess(token);
      client.data.user = payload;
      await client.join(roomForUser(payload.sub));
      await this.presence.connect(payload.sub, client.id);
      // heartbeat 30s pour renew TTL Redis
      client.data.hbTimer = setInterval(
        () => this.presence.heartbeat(payload.sub).catch(() => {}),
        30_000,
      );
      this.logger.log(`WS connected user=${payload.sub} sid=${client.id}`);
    } catch (e) {
      this.logger.warn(`WS rejected: ${(e as Error).message}`);
      client.emit('error', { code: 'unauthorized' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: AuthedSocket) {
    if (client.data?.hbTimer) clearInterval(client.data.hbTimer);
    if (client.data?.user) {
      await this.presence.disconnect(client.data.user.sub, client.id).catch(() => {});
      this.logger.log(`WS disconnected user=${client.data.user.sub} sid=${client.id}`);
    }
  }

  @SubscribeMessage('conversation.join')
  async onJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ) {
    if (!(await this.rateLimitOk(client.data.user.sub))) {
      return { ok: false, code: 'rate_limited' };
    }
    const conversationId = body?.conversationId;
    if (!conversationId || typeof conversationId !== 'string') {
      return { ok: false, code: 'bad_request' };
    }
    try {
      await this.conversations.assertCanAccess(
        client.data.user.sub,
        client.data.user.role,
        conversationId,
      );
      await client.join(roomForConversation(conversationId));
      return { ok: true };
    } catch {
      return { ok: false, code: 'forbidden' };
    }
  }

  @SubscribeMessage('conversation.leave')
  async onLeave(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string },
  ) {
    if (body?.conversationId) {
      await client.leave(roomForConversation(body.conversationId));
    }
    return { ok: true };
  }

  @SubscribeMessage('typing')
  async onTyping(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { conversationId?: string; isTyping?: boolean },
  ) {
    if (!(await this.rateLimitOk(client.data.user.sub))) return;
    if (!body?.conversationId) return;
    try {
      await this.conversations.assertCanAccess(
        client.data.user.sub,
        client.data.user.role,
        body.conversationId,
      );
    } catch {
      return;
    }
    client.to(roomForConversation(body.conversationId)).emit('typing', {
      conversationId: body.conversationId,
      userId: client.data.user.sub,
      isTyping: !!body.isTyping,
    });
  }

  @SubscribeMessage('presence.ping')
  async onPing(@ConnectedSocket() client: AuthedSocket) {
    if (client.data?.user) await this.presence.heartbeat(client.data.user.sub);
    return { ok: true, ts: Date.now() };
  }

  private extractToken(client: Socket): string | undefined {
    const fromAuth = (client.handshake.auth as any)?.token;
    if (fromAuth && typeof fromAuth === 'string') return fromAuth;
    const cookie = client.handshake.headers.cookie ?? '';
    const match = cookie.match(/access_token=([^;]+)/);
    return match?.[1];
  }

  private async rateLimitOk(userId: string): Promise<boolean> {
    const key = `ws_rl:${userId}:${Math.floor(Date.now() / 60_000)}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 65);
    return count <= this.wsLimit;
  }
}
