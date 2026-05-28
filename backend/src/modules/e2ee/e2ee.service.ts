import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { MlsKeyPackage } from './entities/mls-key-package.entity';
import { MlsGroup } from './entities/mls-group.entity';
import { MlsMessage, MlsKind } from './entities/mls-message.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { ConversationsService } from '../conversations/conversations.service';
import { AuditService } from '../audit/audit.service';

/**
 * Service serveur pour MLS (RFC 9420) :
 *  - Stocke et distribue KeyPackages (clés publiques + sigs) publiés par les clients
 *  - Persiste un MlsGroup par conversation E2EE (1 conv = 1 groupe)
 *  - Achemine les MlsMessages opaques (le serveur NE DÉCHIFFRE PAS)
 *  - Welcome ciblé → un user spécifique récupère son welcome au login
 *
 * Le serveur ne participe à AUCUN calcul cryptographique MLS — il transporte.
 */
@Injectable()
export class E2eeService {
  constructor(
    @InjectRepository(MlsKeyPackage) private readonly kpRepo: Repository<MlsKeyPackage>,
    @InjectRepository(MlsGroup) private readonly groupRepo: Repository<MlsGroup>,
    @InjectRepository(MlsMessage) private readonly msgRepo: Repository<MlsMessage>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    private readonly conversations: ConversationsService,
    private readonly audit: AuditService,
    private readonly ds: DataSource,
  ) {}

  // -------- KeyPackages --------

  async publishKeyPackages(input: {
    userId: string;
    deviceId: string;
    cipherSuite: string;
    keyPackages: Buffer[]; // pool
    ttlDays?: number;
  }) {
    if (input.keyPackages.length === 0) throw new BadRequestException('Empty pool');
    if (input.keyPackages.length > 100) throw new BadRequestException('Pool too large');
    const expires = new Date(Date.now() + (input.ttlDays ?? 30) * 86_400_000);
    const rows = input.keyPackages.map((kp) =>
      this.kpRepo.create({
        userId: input.userId,
        deviceId: input.deviceId,
        cipherSuite: input.cipherSuite,
        keyPackage: kp,
        expiresAt: expires,
      }),
    );
    await this.kpRepo.save(rows);
    return { published: rows.length };
  }

  /** Réclame un KeyPackage du user cible (consume). */
  async claimKeyPackage(input: {
    targetUserId: string;
    requesterId: string;
    cipherSuite: string;
  }): Promise<{ keyPackageId: string; keyPackage: Buffer; deviceId: string }> {
    return this.ds.transaction(async (m) => {
      const repo = m.getRepository(MlsKeyPackage);
      const kp = await repo
        .createQueryBuilder('k')
        .setLock('pessimistic_write')
        .where('k.user_id = :u', { u: input.targetUserId })
        .andWhere('k.cipher_suite = :c', { c: input.cipherSuite })
        .andWhere('k.consumed_at IS NULL')
        .andWhere('k.expires_at > now()')
        .orderBy('k.created_at', 'ASC')
        .limit(1)
        .getOne();
      if (!kp) throw new NotFoundException('Aucun KeyPackage disponible pour ce user');
      kp.consumedAt = new Date();
      kp.consumedBy = input.requesterId;
      await repo.save(kp);
      return { keyPackageId: kp.id, keyPackage: kp.keyPackage, deviceId: kp.deviceId };
    });
  }

  async countAvailable(userId: string, cipherSuite: string): Promise<number> {
    return this.kpRepo.count({
      where: { userId, cipherSuite, consumedAt: IsNull(), expiresAt: MoreThan(new Date()) },
    });
  }

  // -------- Groupes / opt-in E2EE --------

  async enableE2ee(input: {
    conversationId: string;
    actorId: string;
    actorRole: any;
    groupIdMls: Buffer;
    cipherSuite: string;
    welcomeMessages: { targetUserId: string; ciphertext: Buffer; senderDeviceId: string }[];
  }) {
    const { conversation } = await this.conversations.assertCanAccess(
      input.actorId,
      input.actorRole,
      input.conversationId,
    );
    if (conversation.e2eeEnabled) throw new ConflictException('Déjà E2EE');

    return this.ds.transaction(async (m) => {
      const group = await m.getRepository(MlsGroup).save(
        m.getRepository(MlsGroup).create({
          conversationId: input.conversationId,
          groupIdMls: input.groupIdMls,
          cipherSuite: input.cipherSuite,
          epoch: '0',
          createdBy: input.actorId,
        }),
      );
      // Persister les Welcomes
      let seq = 0n;
      for (const w of input.welcomeMessages) {
        seq += 1n;
        await m.getRepository(MlsMessage).save(
          m.getRepository(MlsMessage).create({
            groupId: group.id,
            senderUserId: input.actorId,
            senderDeviceId: w.senderDeviceId,
            kind: 'welcome',
            epoch: '0',
            sequence: seq.toString(),
            targetUserId: w.targetUserId,
            ciphertext: w.ciphertext,
          }),
        );
      }
      await m.getRepository(Conversation).update(input.conversationId, {
        e2eeEnabled: true,
        e2eeEnabledAt: new Date(),
      });
      await this.audit.log({
        actorId: input.actorId,
        action: 'e2ee.enabled',
        targetType: 'conversation',
        targetId: input.conversationId,
        metadata: { cipherSuite: input.cipherSuite, welcomes: input.welcomeMessages.length },
      });
      return { groupId: group.id };
    });
  }

  // -------- Messages MLS opaques --------

  /** Sender publie un MlsMessage (commit/proposal/application). Serveur ne lit pas. */
  async sendMlsMessage(input: {
    conversationId: string;
    senderId: string;
    senderRole: any;
    senderDeviceId: string;
    kind: MlsKind;
    epoch: string;
    ciphertext: Buffer;
    targetUserId?: string;
  }) {
    await this.conversations.assertCanAccess(input.senderId, input.senderRole, input.conversationId);
    const group = await this.groupRepo.findOne({ where: { conversationId: input.conversationId } });
    if (!group) throw new NotFoundException('Pas de groupe MLS');

    return this.ds.transaction(async (m) => {
      // Verrou par groupe pour assigner sequence
      const g = await m
        .getRepository(MlsGroup)
        .createQueryBuilder('g')
        .setLock('pessimistic_write')
        .where('g.id = :id', { id: group.id })
        .getOne();
      const lastSeq = await m
        .getRepository(MlsMessage)
        .createQueryBuilder('mm')
        .where('mm.group_id = :g', { g: g!.id })
        .select('COALESCE(MAX(mm.sequence::bigint), 0)', 'max')
        .getRawOne();
      const nextSeq = (BigInt(lastSeq?.max ?? '0') + 1n).toString();

      // Si commit → on bump epoch
      if (input.kind === 'commit') {
        const newEpoch = (BigInt(g!.epoch) + 1n).toString();
        await m.getRepository(MlsGroup).update(g!.id, { epoch: newEpoch });
      }

      const saved = await m.getRepository(MlsMessage).save(
        m.getRepository(MlsMessage).create({
          groupId: g!.id,
          senderUserId: input.senderId,
          senderDeviceId: input.senderDeviceId,
          kind: input.kind,
          epoch: input.epoch,
          sequence: nextSeq,
          targetUserId: input.targetUserId ?? null,
          ciphertext: input.ciphertext,
        }),
      );
      return { id: saved.id, sequence: nextSeq };
    });
  }

  /** Pull des MlsMessages depuis une sequence (pour pickup offline). */
  async listMlsMessages(input: {
    conversationId: string;
    userId: string;
    userRole: any;
    afterSequence?: string;
    limit?: number;
  }) {
    await this.conversations.assertCanAccess(input.userId, input.userRole, input.conversationId);
    const group = await this.groupRepo.findOne({ where: { conversationId: input.conversationId } });
    if (!group) throw new NotFoundException('Pas de groupe MLS');

    const qb = this.msgRepo
      .createQueryBuilder('m')
      .where('m.group_id = :g', { g: group.id })
      .andWhere('(m.target_user_id IS NULL OR m.target_user_id = :u)', { u: input.userId });
    if (input.afterSequence) {
      qb.andWhere('m.sequence > :s', { s: input.afterSequence });
    }
    qb.orderBy('m.sequence', 'ASC').limit(Math.min(input.limit ?? 100, 500));
    return qb.getMany();
  }
}
