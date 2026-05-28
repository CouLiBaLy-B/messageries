import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Message } from '../messages/entities/message.entity';
import { OpenSearchService } from './opensearch.service';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { CryptoModule } from '../crypto/crypto.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Conversation, Message]),
    ConversationsModule,
    CryptoModule,
    AuditModule,
  ],
  providers: [OpenSearchService, SearchService],
  controllers: [SearchController],
  exports: [SearchService],
})
export class SearchModule {}
