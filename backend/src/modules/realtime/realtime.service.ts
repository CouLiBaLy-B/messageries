import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { Message } from '../messages/entities/message.entity';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  async publishMessageCreated(message: Message) {
    try {
      this.gateway.server
        ?.to(roomForConversation(message.conversationId))
        .emit('message.created', {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          sequence: message.sequence,
          body: message.body,
          createdAt: message.createdAt,
        });
    } catch (e) {
      this.logger.warn(`Realtime publish failed for ${message.id}: ${(e as Error).message}`);
    }
  }

  async publishMessageDeleted(message: Message) {
    this.gateway.server
      ?.to(roomForConversation(message.conversationId))
      .emit('message.deleted', {
        id: message.id,
        conversationId: message.conversationId,
        sequence: message.sequence,
      });
  }

  async publishReadReceipt(payload: {
    conversationId: string;
    userId: string;
    uptoSequence: string;
  }) {
    this.gateway.server
      ?.to(roomForConversation(payload.conversationId))
      .emit('message.read', payload);
  }
}

export function roomForConversation(id: string) {
  return `conv:${id}`;
}

export function roomForUser(id: string) {
  return `user:${id}`;
}
