import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { ConversationParticipant } from '../conversations/entities/conversation-participant.entity';
import { Message } from '../messages/entities/message.entity';
import { Attachment } from '../attachments/entities/attachment.entity';
import { EnvelopeCryptoService } from '../crypto/envelope-crypto.service';
import { AuditService } from '../audit/audit.service';
import { RefreshTokensService } from '../auth/refresh-tokens.service';

/**
 * RGPD :
 *  - Export : dump JSON des données personnelles + messages déchiffrés de l'utilisateur.
 *  - Suppression : on N'EFFACE PAS les messages (preuves litiges commerciaux),
 *    mais on anonymise le user et on remplace ses messages par un placeholder + drop des DEKs.
 *    → respect du compromis "droit à l'oubli" vs "tenue de comptes / obligations e-commerce".
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Conversation) private readonly convs: Repository<Conversation>,
    @InjectRepository(ConversationParticipant) private readonly parts: Repository<ConversationParticipant>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(Attachment) private readonly attachments: Repository<Attachment>,
    private readonly crypto: EnvelopeCryptoService,
    private readonly audit: AuditService,
    private readonly refreshTokens: RefreshTokensService,
    private readonly ds: DataSource,
  ) {}

  async exportUserData(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException();

    const participants = await this.parts.find({ where: { userId } });
    const convIds = participants.map((p) => p.conversationId);

    const messages =
      convIds.length === 0
        ? []
        : await this.messages
            .createQueryBuilder('m')
            .where('m.sender_id = :u', { u: userId })
            .andWhere('m.deleted_at IS NULL')
            .getMany();

    const decrypted = await Promise.all(
      messages.map(async (m) => ({
        id: m.id,
        conversationId: m.conversationId,
        sequence: m.sequence,
        createdAt: m.createdAt,
        body: await this.decryptIfNeeded(m),
      })),
    );

    const userAttachments = await this.attachments.find({ where: { uploaderId: userId } });

    await this.users.update(userId, { dataExportRequestedAt: new Date() });
    await this.audit.log({
      actorId: userId,
      action: 'privacy.exported',
      targetType: 'user',
      targetId: userId,
    });

    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        createdAt: user.createdAt,
      },
      conversations: convIds,
      messages: decrypted,
      attachments: userAttachments.map((a) => ({
        id: a.id,
        conversationId: a.conversationId,
        originalFilename: a.originalFilename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt,
      })),
    };
  }

  /**
   * Anonymisation : on conserve l'intégrité référentielle (audit, litiges),
   * mais on supprime toute donnée personnelle identifiante + on rend les messages illisibles.
   */
  async anonymizeUser(userId: string, actorId: string) {
    await this.ds.transaction(async (m) => {
      const user = await m.getRepository(User).findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException();
      if (user.anonymizedAt) return;

      const pseudoEmail = `anon_${user.id}@deleted.invalid`;
      await m.getRepository(User).update(userId, {
        email: pseudoEmail,
        displayName: 'Utilisateur supprimé',
        passwordHash: 'INVALID',
        mfaSecret: null,
        anonymizedAt: new Date(),
        isSuspended: true,
      });

      // Wipe messages : on conserve sequence et metadata, on efface le contenu
      await m.query(
        `UPDATE messages
            SET body = NULL,
                body_ciphertext = NULL,
                body_iv = NULL,
                body_tag = NULL,
                body_dek_id = NULL,
                body_alg = NULL,
                status = 'deleted',
                deleted_at = COALESCE(deleted_at, now())
          WHERE sender_id = $1`,
        [userId],
      );

      // Révoquer les sessions
      await this.refreshTokens.revokeAllForUser(userId, 'gdpr_anonymized');
    });

    await this.audit.log({
      actorId,
      action: 'privacy.anonymized',
      targetType: 'user',
      targetId: userId,
    });
  }

  private async decryptIfNeeded(m: Message): Promise<string> {
    if (m.body != null) return m.body;
    if (!m.bodyCiphertext || !m.bodyIv || !m.bodyTag || !m.bodyDekId) return '';
    try {
      return await this.crypto.decrypt({
        ciphertext: m.bodyCiphertext,
        iv: m.bodyIv,
        tag: m.bodyTag,
        dekId: m.bodyDekId,
      });
    } catch (e) {
      this.logger.warn(`decrypt failed msg=${m.id}: ${(e as Error).message}`);
      return '';
    }
  }
}
