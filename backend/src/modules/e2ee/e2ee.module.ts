import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MlsKeyPackage } from './entities/mls-key-package.entity';
import { MlsGroup } from './entities/mls-group.entity';
import { MlsMessage } from './entities/mls-message.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { E2eeService } from './e2ee.service';
import { KeyPackagesController } from './controllers/key-packages.controller';
import { MlsGroupsController } from './controllers/mls-groups.controller';
import { MlsMessagesController } from './controllers/mls-messages.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MlsKeyPackage, MlsGroup, MlsMessage, Conversation]),
    ConversationsModule,
    AuditModule,
    AuthModule,
  ],
  providers: [E2eeService],
  controllers: [KeyPackagesController, MlsGroupsController, MlsMessagesController],
  exports: [E2eeService],
})
export class E2eeModule {}
