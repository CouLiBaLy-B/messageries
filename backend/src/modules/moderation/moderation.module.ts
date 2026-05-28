import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageReport } from './entities/message-report.entity';
import { Message } from '../messages/entities/message.entity';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';
import { ContentScannerService } from './content-scanner.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([MessageReport, Message]), AuditModule],
  providers: [ModerationService, ContentScannerService],
  controllers: [ModerationController],
  exports: [ContentScannerService, ModerationService],
})
export class ModerationModule {}
