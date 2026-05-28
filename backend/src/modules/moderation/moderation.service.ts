import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MessageReport } from './entities/message-report.entity';
import { Message } from '../messages/entities/message.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ModerationService {
  constructor(
    @InjectRepository(MessageReport) private readonly reports: Repository<MessageReport>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    private readonly audit: AuditService,
  ) {}

  async report(input: {
    messageId: string;
    reporterId: string;
    reason: string;
    details?: string;
  }) {
    const msg = await this.messages.findOne({ where: { id: input.messageId } });
    if (!msg) throw new NotFoundException();
    const report = await this.reports.save(
      this.reports.create({
        messageId: input.messageId,
        reporterId: input.reporterId,
        reason: input.reason,
        details: input.details,
      }),
    );
    await this.audit.log({
      actorId: input.reporterId,
      action: 'message.reported',
      targetType: 'message',
      targetId: input.messageId,
      metadata: { reportId: report.id, reason: input.reason },
    });
    return report;
  }

  async listOpen(limit = 50) {
    return this.reports.find({
      where: { status: 'open' },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async resolve(input: {
    reportId: string;
    moderatorId: string;
    action: 'dismiss' | 'hide_message';
  }) {
    const r = await this.reports.findOne({ where: { id: input.reportId } });
    if (!r) throw new NotFoundException();
    r.status = input.action === 'dismiss' ? 'dismissed' : 'actioned';
    r.resolvedBy = input.moderatorId;
    r.resolvedAt = new Date();
    await this.reports.save(r);

    if (input.action === 'hide_message') {
      await this.messages.update(
        { id: r.messageId },
        {
          status: 'hidden',
          moderatedBy: input.moderatorId,
          moderatedAt: new Date(),
        },
      );
    }
    await this.audit.log({
      actorId: input.moderatorId,
      action: `report.${input.action}`,
      targetType: 'report',
      targetId: r.id,
      metadata: { messageId: r.messageId },
    });
    return r;
  }
}
