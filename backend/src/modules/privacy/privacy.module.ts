import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { ConversationParticipant } from '../conversations/entities/conversation-participant.entity';
import { Message } from '../messages/entities/message.entity';
import { Attachment } from '../attachments/entities/attachment.entity';
import { PrivacyService } from './privacy.service';
import { PrivacyController } from './privacy.controller';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { CryptoModule } from '../crypto/crypto.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Conversation, ConversationParticipant, Message, Attachment]),
    AuthModule,
    AuditModule,
    CryptoModule,
  ],
  providers: [PrivacyService],
  controllers: [PrivacyController],
  exports: [PrivacyService],
})
export class PrivacyModule {}
