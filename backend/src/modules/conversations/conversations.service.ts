import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import {
  ConversationParticipant,
  ParticipantRole,
} from './entities/conversation-participant.entity';
import { OrdersService } from '../orders/orders.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(ConversationParticipant)
    private readonly partRepo: Repository<ConversationParticipant>,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Récupère ou crée la conversation associée à une commande.
   * Garantit l'unicité même en cas de concurrence (UNIQUE(order_id)).
   */
  async getOrCreateForOrder(orderId: string, actorId: string): Promise<Conversation> {
    const order = await this.orders.getOrThrow(orderId);

    const existing = await this.convRepo.findOne({ where: { orderId } });
    if (existing) return existing;

    return this.dataSource.transaction(async (m) => {
      try {
        const conv = await m.getRepository(Conversation).save(
          m.getRepository(Conversation).create({
            orderId,
            status: 'open',
            subject: `Commande ${order.externalRef}`,
          }),
        );

        const participants: ConversationParticipant[] = [
          m.getRepository(ConversationParticipant).create({
            conversationId: conv.id,
            userId: order.customerId,
            role: 'customer',
          }),
          m.getRepository(ConversationParticipant).create({
            conversationId: conv.id,
            userId: order.sellerId,
            role: 'seller',
          }),
        ];
        await m.getRepository(ConversationParticipant).save(participants);

        await this.audit.log({
          actorId,
          action: 'conversation.created',
          targetType: 'conversation',
          targetId: conv.id,
          metadata: { orderId, externalRef: order.externalRef },
        });

        return conv;
      } catch (e: any) {
        if (e?.code === '23505') {
          const c = await m.getRepository(Conversation).findOne({ where: { orderId } });
          if (c) return c;
        }
        throw e;
      }
    });
  }

  async getByIdOrThrow(id: string): Promise<Conversation> {
    const c = await this.convRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Conversation introuvable');
    return c;
  }

  async listForUser(userId: string, limit = 30) {
    return this.convRepo
      .createQueryBuilder('c')
      .innerJoin(
        'conversation_participants',
        'p',
        'p.conversation_id = c.id AND p.user_id = :userId AND p.left_at IS NULL',
        { userId },
      )
      .orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
      .limit(limit)
      .getMany();
  }

  /** Vérifie qu'un user peut accéder à une conversation. Support/admin = accès journalisé. */
  async assertCanAccess(
    userId: string,
    role: 'customer' | 'seller' | 'support' | 'admin',
    conversationId: string,
  ): Promise<{ conversation: Conversation; participantRole: ParticipantRole }> {
    const conv = await this.getByIdOrThrow(conversationId);

    const participant = await this.partRepo.findOne({
      where: { conversationId, userId, leftAt: IsNull() },
    });

    if (participant) {
      return { conversation: conv, participantRole: participant.role };
    }

    // Support/admin peuvent rejoindre : on logge l'accès et on les ajoute
    if (role === 'support' || role === 'admin') {
      await this.partRepo.save(
        this.partRepo.create({
          conversationId,
          userId,
          role,
        }),
      );
      await this.audit.log({
        actorId: userId,
        action: 'conversation.support_joined',
        targetType: 'conversation',
        targetId: conversationId,
        metadata: { role },
      });
      return { conversation: conv, participantRole: role };
    }

    throw new ForbiddenException("Vous n'êtes pas autorisé sur cette conversation");
  }

  async assertCanWrite(conversation: Conversation) {
    if (conversation.status !== 'open') {
      throw new ConflictException('Conversation fermée ou archivée');
    }
  }

  /** Met à jour last_message_at + last_sequence (appelé par MessagesService dans la même TX). */
  async bumpLastMessage(manager: any, conversationId: string, sequence: string) {
    await manager
      .createQueryBuilder()
      .update(Conversation)
      .set({ lastMessageAt: () => 'now()', lastSequence: sequence })
      .where('id = :id', { id: conversationId })
      .execute();
  }

  async listParticipants(conversationId: string) {
    return this.partRepo.find({ where: { conversationId } });
  }
}
