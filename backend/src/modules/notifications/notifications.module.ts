import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { EmailNotification } from './entities/email-notification.entity';
import { User } from '../users/entities/user.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { NotificationsService } from './notifications.service';
import { EmailService } from './email.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([EmailNotification, User, Conversation]),
  ],
  providers: [NotificationsService, EmailService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
