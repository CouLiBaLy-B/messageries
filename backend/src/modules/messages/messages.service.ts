import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Message } from './entities/message.entity';
import { MessageReceipt } from './entities/message-receipt.entity';
import { OutboxEvent } from './entities/outbox-event.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { ConversationParticipant } from '../conversations/entities/conversation-participant.entity';
import { ConversationsService } from '../conversations/conversations.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditService } from '../audit/audit.service';
import { EnvelopeCryptoService } from '../crypto/envelope-crypto.service';
import { ContentScannerService } from '../moderation/content-scanner.service';
import { MetricsService } from '../observability/metrics.service';

export interface SendMessageInput {
  conversationId: string;
  senderId: string;
  body: string;
  idempotencyKey?: string;
}

export interface DecryptedMessage extends Omit<Message, 'bodyCiphertext' | 'bodyIv' | 'bodyTag'> {
  body: string;
}

@Injectable()
export class MessagesService {
  constructor(
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(MessageReceipt) private readonly receiptRepo: Repository<MessageReceipt>,
    @InjectRepository(OutboxEvent) private readonly outboxRepo: Repository<OutboxEvent>,
    private readonly dataSource: DataSource,
    private readonly conversations: ConversationsService,
    @Inject(forwardRef(() => RealtimeService))
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly cfg: ConfigService,
    private readonly crypto: EnvelopeCryptoService,
    private readonly scanner: ContentScannerService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  private get encryptionEnabled() {
    return this.cfg.get<boolean>('ENCRYPT_MESSAGE_BODY', true);
  }

  async send(input: SendMessageInput): Promise<DecryptedMessage> {
    const t0 = Date.now();
    const maxLen = this.cfg.get<number>('MAX_MESSAGE_LENGTH', 4000);
    const trimmed = input.body?.trim();
    if (!trimmed) throw new ForbiddenException('Message vide');
    if (trimmed.length > maxLen) throw new ForbiddenException('Message trop long');

    const scan = this.scanner.scan(trimmed);
    if (scan.hadSensitive) {
      this.metrics?.count('ModerationFlagged', 1);
      for (const flag of scan.flags) {
        this.metrics?.count('ModerationFlagByType', 1, { flag });
      }
    }

    let bodyCiphertext: Buffer | null = null;
    let bodyIv: Buffer | null = null;
    let bodyTag: Buffer | null = null;
    let bodyDekId: string | null = null;
    let bodyAlg: string | null = null;
    let bodyPlain: string | null = scan.cleaned;

    if (this.encryptionEnabled) {
      const enc = await this.crypto.encrypt(scan.cleaned);
      bodyCiphertext = enc.ciphertext;
      bodyIv = enc.iv;
      bodyTag = enc.tag;
      bodyDekId = enc.dekId;
      bodyAlg = enc.alg;
      bodyPlain = null;
      this.metrics?.count('MessagesEncrypted', 1);
    } else {
      this.metrics?.count('MessagesPlaintext', 1);
    }

    const message = await this.dataSource.transaction(async (m) => {
      const conv = await m
        .getRepository(Conversation)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: input.conversationId })
        .getOne();
      if (!conv) throw new NotFoundException('Conversation introuvable');
      await this.conversations.assertCanWrite(conv);

      const part = await m.getRepository(ConversationParticipant).findOne({
        where: { conversationId: conv.id, userId: input.senderId },
      });
      if (!part || part.leftAt) {
        throw new ForbiddenException("Vous n'êtes pas participant");
      }

      if (input.idempotencyKey) {
        const existing = await m.getRepository(Message).findOne({
          where: {
            conversationId: conv.id,
            senderId: input.senderId,
            idempotencyKey: input.idempotencyKey,
          },
        });
        if (existing) return existing;
      }

      const nextSeq = (BigInt(conv.lastSequence ?? '0') + 1n).toString();

      const msg = await m.getRepository(Message).save(
        m.getRepository(Message).create({
          conversationId: conv.id,
          senderId: input.senderId,
          sequence: nextSeq,
          body: bodyPlain,
          bodyCiphertext,
          bodyIv,
          bodyTag,
          bodyDekId,
          bodyAlg,
          bodyFormat: 'plain_text',
          status: scan.score >= 0.6 ? 'flagged' : 'sent',
          idempotencyKey: input.idempotencyKey ?? null,
          moderationFlags: scan.flags.length ? scan.flags : null,
          moderationScore: scan.score,
        }),
      );

      const participants = await m
        .getRepository(ConversationParticipant)
        .find({ where: { conversationId: conv.id } });
      const receipts = participants
        .filter((p) => p.userId !== input.senderId && !p.leftAt)
        .map((p) =>
          m.getRepository(MessageReceipt).create({
            messageId: msg.id,
            userId: p.userId,
          }),
        );
      if (receipts.length) await m.getRepository(MessageReceipt).save(receipts);

      await m.getRepository(OutboxEvent).save(
        m.getRepository(OutboxEvent).create({
          eventType: 'message.created',
          aggregateId: conv.id,
          payload: {
            messageId: msg.id,
            conversationId: conv.id,
            senderId: input.senderId,
            sequence: nextSeq,
            createdAt: msg.createdAt,
            body: scan.cleaned,
            moderationFlags: scan.flags.length ? scan.flags : null,
            recipients: participants.filter((p) => p.userId !== input.senderId).map((p) => p.userId),
          },
        }),
      );

      await this.conversations.bumpLastMessage(m, conv.id, nextSeq);

      if (scan.hadSensitive) {
        await this.audit.log({
          actorId: input.senderId,
          action: 'message.sensitive_redacted',
          targetType: 'message',
          targetId: msg.id,
          metadata: { flags: scan.flags, score: scan.score },
        });
      }

      return msg;
    });

    const decrypted = await this.toDecrypted(message, scan.cleaned);
    await this.realtime.publishMessageCreated(decrypted);
    this.metrics?.count('MessagesSent', 1);
    this.metrics?.timing('MessageSendDurationMs', Date.now() - t0);
    return decrypted;
  }

  async list(params: {
    conversationId: string;
    afterSequence?: string;
    beforeSequence?: string;
    limit?: number;
  }): Promise<DecryptedMessage[]> {
    const limit = Math.min(params.limit ?? 50, 100);
    const qb = this.msgRepo
      .createQueryBuilder('m')
      .where('m.conversation_id = :cid', { cid: params.conversationId })
      .andWhere('m.deleted_at IS NULL');

    if (params.afterSequence) {
      qb.andWhere('m.sequence > :after', { after: params.afterSequence });
      qb.orderBy('m.sequence', 'ASC');
    } else if (params.beforeSequence) {
      qb.andWhere('m.sequence < :before', { before: params.beforeSequence });
      qb.orderBy('m.sequence', 'DESC');
    } else {
      qb.orderBy('m.sequence', 'DESC');
    }
    const rows = await qb.limit(limit).getMany();
    return Promise.all(rows.map((m) => this.toDecrypted(m)));
  }

  async markRead(conversationId: string, userId: string, uptoSequence: string) {
    await this.dataSource.transaction(async (m) => {
      await m
        .createQueryBuilder()
        .update(ConversationParticipant)
        .set({ lastReadSequence: uptoSequence })
        .where('conversation_id = :cid AND user_id = :uid', {
          cid: conversationId,
          uid: userId,
        })
        .execute();

      await m.query(
        `UPDATE message_receipts r
           SET read_at = now()
          WHERE r.user_id = $1
            AND r.read_at IS NULL
            AND r.message_id IN (
              SELECT id FROM messages
               WHERE conversation_id = $2
                 AND sequence <= $3::bigint
            )`,
        [userId, conversationId, uptoSequence],
      );

      await m.query(
        `INSERT INTO message_events_outbox (event_type, aggregate_id, payload)
         VALUES ('message.read', $1, $2)`,
        [
          conversationId,
          JSON.stringify({ conversationId, userId, uptoSequence }),
        ],
      );
    });

    await this.realtime.publishReadReceipt({ conversationId, userId, uptoSequence });
  }

  async softDelete(messageId: string, actorId: string) {
    const msg = await this.msgRepo.findOne({ where: { id: messageId } });
    if (!msg) throw new NotFoundException();
    if (msg.senderId !== actorId) {
      throw new ForbiddenException('Vous ne pouvez supprimer que vos messages');
    }
    msg.status = 'deleted';
    msg.deletedAt = new Date();
    msg.body = null;
    msg.bodyCiphertext = null;
    msg.bodyIv = null;
    msg.bodyTag = null;
    msg.bodyDekId = null;
    await this.msgRepo.save(msg);
    await this.audit.log({
      actorId,
      action: 'message.deleted',
      targetType: 'message',
      targetId: messageId,
    });
    await this.realtime.publishMessageDeleted(msg as any);
  }

  private async toDecrypted(m: Message, knownPlain?: string): Promise<DecryptedMessage> {
    let body = '';
    if (m.status === 'deleted') {
      body = '';
    } else if (m.status === 'hidden') {
      body = '[Message masqué par la modération]';
    } else if (knownPlain != null) {
      body = knownPlain;
    } else if (m.body != null) {
      body = m.body;
    } else if (m.bodyCiphertext && m.bodyIv && m.bodyTag && m.bodyDekId) {
      body = await this.crypto.decrypt({
        ciphertext: m.bodyCiphertext,
        iv: m.bodyIv,
        tag: m.bodyTag,
        dekId: m.bodyDekId,
      });
    }
    const { bodyCiphertext, bodyIv, bodyTag, ...rest } = m;
    return { ...(rest as any), body };
  }
}
