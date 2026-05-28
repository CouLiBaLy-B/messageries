import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { v4 as uuid } from 'uuid';
import { Attachment } from './entities/attachment.entity';
import { S3Service } from './s3.service';
import { ConversationsService } from '../conversations/conversations.service';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
]);

@Injectable()
export class AttachmentsService {
  constructor(
    @InjectRepository(Attachment) private readonly repo: Repository<Attachment>,
    private readonly s3: S3Service,
    private readonly conversations: ConversationsService,
    private readonly cfg: ConfigService,
  ) {}

  async presignUpload(input: {
    userId: string;
    userRole: 'customer' | 'seller' | 'support' | 'admin';
    conversationId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    if (!ALLOWED_MIME.has(input.mimeType)) {
      throw new BadRequestException('Type de fichier non autorisé');
    }
    const maxMb = this.cfg.get<number>('MAX_ATTACHMENT_MB', 10);
    if (input.sizeBytes <= 0 || input.sizeBytes > maxMb * 1024 * 1024) {
      throw new BadRequestException(`Taille max ${maxMb} MB`);
    }
    // Vérif accès conversation (revérification stricte)
    await this.conversations.assertCanAccess(
      input.userId,
      input.userRole,
      input.conversationId,
    );

    const objectKey = `conv/${input.conversationId}/${uuid()}-${sanitizeFilename(input.filename)}`;

    const uploadUrl = await this.s3.presignPut(
      objectKey,
      input.mimeType,
      input.sizeBytes,
      300, // 5 min
    );

    // On crée l'entrée DB en pending (sans message_id : sera attaché à l'envoi)
    const att = await this.repo.save(
      this.repo.create({
        conversationId: input.conversationId,
        uploaderId: input.userId,
        objectKey,
        originalFilename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes.toString(),
        scanStatus: this.cfg.get<boolean>('CLAMAV_ENABLED', false) ? 'pending' : 'clean',
      }),
    );

    return {
      attachmentId: att.id,
      uploadUrl,
      objectKey,
      expiresIn: 300,
    };
  }

  /** Appelé après l'upload réussi : vérif tête S3, déclenche scan async. */
  async finalize(attachmentId: string, userId: string) {
    const att = await this.repo.findOne({ where: { id: attachmentId } });
    if (!att) throw new NotFoundException('Attachment introuvable');
    if (att.uploaderId !== userId) throw new ForbiddenException();

    try {
      const head = await this.s3.head(att.objectKey);
      const realSize = Number(head.ContentLength ?? 0);
      const declared = Number(att.sizeBytes);
      if (Math.abs(realSize - declared) > 1024) {
        await this.s3.delete(att.objectKey);
        await this.repo.remove(att);
        throw new BadRequestException('Taille déclarée incohérente');
      }
    } catch (e) {
      throw new BadRequestException('Upload introuvable sur le stockage');
    }

    // TODO Phase 2 : enqueue ClamAV scan, attendre `clean` avant exposition.
    return att;
  }

  async getDownloadUrl(input: {
    attachmentId: string;
    userId: string;
    userRole: 'customer' | 'seller' | 'support' | 'admin';
  }) {
    const att = await this.repo.findOne({ where: { id: input.attachmentId } });
    if (!att) throw new NotFoundException();
    if (att.scanStatus !== 'clean') {
      throw new ForbiddenException(`Fichier indisponible (scan=${att.scanStatus})`);
    }
    // 🛡️ revérifie l'accès à la conversation à chaque download
    await this.conversations.assertCanAccess(
      input.userId,
      input.userRole,
      att.conversationId,
    );
    const url = await this.s3.presignGet(att.objectKey, 60, att.originalFilename);
    return { url, expiresIn: 60 };
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 120);
}
