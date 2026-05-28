import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { OutboxEvent } from '../messages/entities/outbox-event.entity';
import { OutboxWorker } from './outbox.worker';
import { NotificationsModule } from '../notifications/notifications.module';
import { PresenceModule } from '../presence/presence.module';
import { ObservabilityModule } from '../observability/observability.module';
import { NatsModule } from '../nats/nats.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([OutboxEvent]),
    NotificationsModule,
    PresenceModule,
    ObservabilityModule,
    NatsModule,
  ],
  providers: [OutboxWorker],
  exports: [OutboxWorker],
})
export class OutboxModule {}
