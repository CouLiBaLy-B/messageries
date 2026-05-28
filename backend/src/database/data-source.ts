import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

import { User } from '../modules/users/entities/user.entity';
import { Order } from '../modules/orders/entities/order.entity';
import { Conversation } from '../modules/conversations/entities/conversation.entity';
import { ConversationParticipant } from '../modules/conversations/entities/conversation-participant.entity';
import { Message } from '../modules/messages/entities/message.entity';
import { MessageReceipt } from '../modules/messages/entities/message-receipt.entity';
import { Attachment } from '../modules/attachments/entities/attachment.entity';
import { OutboxEvent } from '../modules/messages/entities/outbox-event.entity';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';
import { MessageReport } from '../modules/moderation/entities/message-report.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { EmailNotification } from '../modules/notifications/entities/email-notification.entity';

const entities = [
  User, Order, Conversation, ConversationParticipant, Message, MessageReceipt,
  Attachment, OutboxEvent, AuditLog, MessageReport, RefreshToken, EmailNotification,
];

export const typeOrmConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities,
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  migrationsRun: false,
  synchronize: false,
  // En prod, on garde des logs minimaux et structurés (ECS → CloudWatch)
  logging: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  // Pool de connexions adapté ECS Fargate
  extra: {
    max: parseInt(process.env.DB_POOL_MAX ?? '10', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  },
});

const dataSourceOptions: DataSourceOptions = { ...(typeOrmConfig() as DataSourceOptions) };
export default new DataSource(dataSourceOptions);
