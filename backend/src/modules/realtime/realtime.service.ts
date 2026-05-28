import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway';
import { Message } from '../messages/entities/message.entity';

/**
 * Service de diffusion temps-réel.
 *  - Mode legacy (Phase 1-4) : utilise RealtimeGateway embarqué (Socket.IO + Redis adapter).
 *  - Mode Phase 5 (WS_GATEWAY_DEDICATED=true) : ne fait rien — c'est le ws-gateway
 *    qui consomme NATS et émet aux clients. Évite la double émission.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly dedicated: boolean;

  constructor(
    private readonly gateway: RealtimeGateway,
    cfg: ConfigService,
  ) {
    this.dedicated = cfg.get<boolean>('WS_GATEWAY_DEDICATED', false);
  }

  async publishMessageCreated(message: Message & { body?: string }) {
    if (this.dedicated || !this.gateway.server) return;
    try {
      this.gateway.server.to(roomForConversation(message.conversationId)).emit('message.created', {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        sequence: message.sequence,
        body: (message as any).body,
        createdAt: message.createdAt,
      });
    } catch (e) {
      this.logger.warn(`realtime publish failed for ${message.id}: ${(e as Error).message}`);
    }
  }

  async publishMessageDeleted(message: Message) {
    if (this.dedicated || !this.gateway.server) return;
    this.gateway.server.to(roomForConversation(message.conversationId)).emit('message.deleted', {
      id: message.id,
      conversationId: message.conversationId,
      sequence: message.sequence,
    });
  }

  async publishReadReceipt(payload: { conversationId: string; userId: string; uptoSequence: string }) {
    if (this.dedicated || !this.gateway.server) return;
    this.gateway.server.to(roomForConversation(payload.conversationId)).emit('message.read', payload);
  }
}

export function roomForConversation(id: string) {
  return `conv:${id}`;
}
export function roomForUser(id: string) {
  return `user:${id}`;
}
