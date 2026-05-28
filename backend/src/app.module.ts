import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { envValidationSchema } from './config/env.validation';
import { typeOrmConfig } from './database/data-source';

// --- Infrastructure (cross-cutting, importées tôt) ---
import { ObservabilityModule } from './modules/observability/observability.module';
import { NatsModule } from './modules/nats/nats.module';

// --- Domain core ---
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';

// --- Realtime ---
import { RealtimeModule } from './modules/realtime/realtime.module';
import { PresenceModule } from './modules/presence/presence.module';

// --- Cross domain features ---
import { CryptoModule } from './modules/crypto/crypto.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SearchModule } from './modules/search/search.module';
import { E2eeModule } from './modules/e2ee/e2ee.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { PrivacyModule } from './modules/privacy/privacy.module';

// --- Plateforme ---
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';

import { RequestContextMiddleware } from './common/middleware/request-context.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    TypeOrmModule.forRoot(typeOrmConfig()),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 5 },
      { name: 'medium', ttl: 60_000, limit: 100 },
    ]),

    // Infra
    ObservabilityModule,
    NatsModule,

    // Domain
    AuthModule,
    UsersModule,
    OrdersModule,
    ConversationsModule,
    MessagesModule,
    AttachmentsModule,

    // Realtime
    PresenceModule,
    RealtimeModule,

    // Features
    CryptoModule,
    ModerationModule,
    NotificationsModule,
    SearchModule,
    E2eeModule,
    OutboxModule,
    PrivacyModule,

    // Platform
    AuditModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
