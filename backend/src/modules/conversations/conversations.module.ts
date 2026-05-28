import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { ConversationAccessGuard } from './guards/conversation-access.guard';
import { OrdersModule } from '../orders/orders.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, ConversationParticipant]),
    OrdersModule,
    AuditModule,
  ],
  providers: [ConversationsService, ConversationAccessGuard],
  controllers: [ConversationsController],
  exports: [ConversationsService, ConversationAccessGuard],
})
export class ConversationsModule {}
