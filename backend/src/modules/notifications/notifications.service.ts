import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EmailNotification } from './entities/email-notification.entity';
import { User } from '../users/entities/user.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { EmailService } from './email.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly throttleMinutes: number;
  private readonly appUrl: string;

  constructor(
    @InjectRepository(EmailNotification)
    private readonly emails: Repository<EmailNotification>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Conversation) private readonly convs: Repository<Conversation>,
    private readonly email: EmailService,
    private readonly cfg: ConfigService,
  ) {
    this.throttleMinutes = cfg.get<number>('EMAIL_THROTTLE_MINUTES', 10);
    this.appUrl = cfg.get<string>('APP_URL', 'http://localhost:8080');
  }

  /**
   * Envoie une notif "vous avez un nouveau message" aux recipients offline.
   * Idempotent : dedup_key UNIQUE (par message_id × user_id).
   * Throttling : pas plus d'1 email "new_message" par 10 min et par couple (user × conversation).
   */
  async notifyNewMessage(input: {
    messageId: string;
    conversationId: string;
    senderId: string;
    recipientIds: string[];
  }) {
    const recipients = await this.users.find({
      where: { id: In(input.recipientIds) },
    });
    const conv = await this.convs.findOne({ where: { id: input.conversationId } });
    if (!conv) return;

    for (const user of recipients) {
      if (user.isSuspended || user.anonymizedAt) continue;

      const dedupKey = `new_message:${input.messageId}:${user.id}`;

      // Throttle par couple user × conversation
      const since = new Date(Date.now() - this.throttleMinutes * 60_000);
      const recent = await this.emails
        .createQueryBuilder('e')
        .where('e.user_id = :u', { u: user.id })
        .andWhere('e.conversation_id = :c', { c: conv.id })
        .andWhere('e.kind = :k', { k: 'new_message' })
        .andWhere('e.sent_at > :s', { s: since })
        .getCount();
      if (recent > 0) continue;

      try {
        await this.email.send({
          to: user.email,
          subject: `Nouveau message — ${conv.subject ?? 'votre commande'}`,
          text:
            `Bonjour,\n\nVous avez reçu un nouveau message concernant ${conv.subject ?? 'votre commande'}.\n` +
            `Connectez-vous : ${this.appUrl}/conversations/${conv.id}\n\n— L'équipe`,
        });
        await this.emails.save(
          this.emails.create({
            userId: user.id,
            conversationId: conv.id,
            kind: 'new_message',
            dedupKey,
          }),
        );
      } catch (e: any) {
        if (e?.code === '23505') {
          // dédup → déjà envoyé
          continue;
        }
        throw e;
      }
    }
  }
}
