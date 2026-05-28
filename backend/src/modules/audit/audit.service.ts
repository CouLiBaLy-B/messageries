import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditInput {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  async log(input: AuditInput) {
    try {
      await this.repo.save(this.repo.create(input));
    } catch (e) {
      // Ne jamais bloquer la requête principale sur un échec d'audit.
      this.logger.error(`audit log failed: ${(e as Error).message}`);
    }
  }
}
