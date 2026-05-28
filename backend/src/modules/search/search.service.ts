import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Message } from '../messages/entities/message.entity';
import { ConversationsService } from '../conversations/conversations.service';
import { EnvelopeCryptoService } from '../crypto/envelope-crypto.service';
import { OpenSearchService } from './opensearch.service';
import { AuditService } from '../audit/audit.service';

/**
 * Service de recherche :
 *  - Opt-in par conversation (search_indexed). Sans opt-in : aucun message n'est indexé.
 *  - À l'opt-in, on backfill l'historique déchiffré.
 *  - L'outbox publie un event "message.indexable" si conv indexée, qu'un worker consomme.
 *  - Search filtre OBLIGATOIREMENT par participants:userId (RBAC OpenSearch).
 */
@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    private readonly conversations: ConversationsService,
    private readonly crypto: EnvelopeCryptoService,
    private readonly os: OpenSearchService,
    private readonly audit: AuditService,
  ) {}

  /** Active l'indexation d'une conversation (opt-in). Tous les participants doivent consentir
   *  → ici on simplifie : le déclencheur doit être customer OU seller, l'autre est notifié.
   */
  async enableIndexing(conversationId: string, actorId: string, actorRole: any) {
    const { conversation } = await this.conversations.assertCanAccess(
      actorId,
      actorRole,
      conversationId,
    );
    if (conversation.searchIndexed) {
      throw new ConflictException('Déjà indexée');
    }
    if (!this.os.isEnabled()) {
      throw new ConflictException('Recherche désactivée côté serveur');
    }

    // Backfill : tous les messages non supprimés
    const messages = await this.msgRepo
      .createQueryBuilder('m')
      .where('m.conversation_id = :c', { c: conversationId })
      .andWhere('m.deleted_at IS NULL')
      .orderBy('m.sequence', 'ASC')
      .getMany();

    const participants = await this.conversations.listParticipants(conversationId);
    const pids = participants.map((p) => p.userId);

    for (const m of messages) {
      const content = await this.decrypt(m);
      if (!content) continue;
      await this.os.indexMessage({
        messageId: m.id,
        conversationId,
        sequence: m.sequence,
        senderId: m.senderId,
        createdAt: m.createdAt,
        content,
        participants: pids,
      });
    }

    await this.convRepo.update(conversationId, {
      searchIndexed: true,
      searchIndexedAt: new Date(),
    });
    await this.audit.log({
      actorId,
      action: 'search.enabled',
      targetType: 'conversation',
      targetId: conversationId,
      metadata: { backfilled: messages.length },
    });
  }

  async disableIndexing(conversationId: string, actorId: string, actorRole: any) {
    await this.conversations.assertCanAccess(actorId, actorRole, conversationId);
    await this.convRepo.update(conversationId, {
      searchIndexed: false,
      searchIndexedAt: null,
    });
    await this.os.deleteByConversation(conversationId);
    await this.audit.log({
      actorId,
      action: 'search.disabled',
      targetType: 'conversation',
      targetId: conversationId,
    });
  }

  async search(input: { userId: string; query: string; conversationId?: string; limit?: number }) {
    if (!this.os.isEnabled()) {
      throw new ConflictException('Recherche désactivée');
    }
    if (!input.query || input.query.length < 2) {
      throw new ForbiddenException('Requête trop courte');
    }
    return this.os.search(input);
  }

  /** Appelé par le worker pour indexer 1 message après création (si conv indexée) */
  async indexMessageIfEnabled(input: {
    conversationId: string;
    messageId: string;
    sequence: string;
    senderId: string;
    createdAt: Date | string;
    content: string;
    participants: string[];
  }) {
    const conv = await this.convRepo.findOne({ where: { id: input.conversationId } });
    if (!conv?.searchIndexed) return;
    await this.os.indexMessage({
      ...input,
      createdAt: new Date(input.createdAt),
    });
  }

  private async decrypt(m: Message): Promise<string> {
    if (m.body) return m.body;
    if (!m.bodyCiphertext || !m.bodyIv || !m.bodyTag || !m.bodyDekId) return '';
    try {
      return await this.crypto.decrypt({
        ciphertext: m.bodyCiphertext,
        iv: m.bodyIv,
        tag: m.bodyTag,
        dekId: m.bodyDekId,
      });
    } catch {
      return '';
    }
  }
}
