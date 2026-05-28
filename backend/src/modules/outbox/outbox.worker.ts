import { Injectable, Logger, Optional, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as os from 'os';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { MetricsService } from '../observability/metrics.service';

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private lagTimer?: NodeJS.Timeout;
  private running = false;
  private readonly workerId = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly cfg: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly presence: PresenceService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async onModuleInit() {
    if (this.cfg.get<boolean>('OUTBOX_WORKER_ENABLED', true)) {
      this.loop();
      // Publish outbox lag every 30s
      this.lagTimer = setInterval(() => this.publishLagMetric().catch(() => {}), 30_000);
      this.logger.log(`Outbox worker started (id=${this.workerId})`);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
    if (this.lagTimer) clearInterval(this.lagTimer);
  }

  private loop() {
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const processed = await this.processBatch(20);
        const idle = processed === 0;
        if (processed > 0) this.metrics?.count('OutboxProcessed', processed);
        this.timer = setTimeout(() => this.loop(), idle ? 1500 : 50);
      } catch (e) {
        this.logger.error(`outbox loop error: ${(e as Error).message}`);
        this.metrics?.count('OutboxLoopError', 1);
        this.timer = setTimeout(() => this.loop(), 3000);
      } finally {
        this.running = false;
      }
    };
    tick();
  }

  private async publishLagMetric() {
    try {
      const rows: any[] = await this.ds.query(
        `SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at)))::int AS lag_seconds
           FROM message_events_outbox
          WHERE processed_at IS NULL`,
      );
      const lag = Number(rows?.[0]?.lag_seconds ?? 0);
      this.metrics?.gauge('OutboxLagSeconds', lag, 'Seconds');
    } catch (e) {
      // silencieux
    }
  }

  private async processBatch(batchSize: number): Promise<number> {
    return this.ds.transaction(async (m) => {
      const rows: any[] = await m.query(
        `SELECT id, event_type, aggregate_id, payload, attempts
           FROM message_events_outbox
          WHERE processed_at IS NULL
            AND next_attempt_at <= now()
          ORDER BY created_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      if (rows.length === 0) return 0;

      for (const row of rows) {
        try {
          await this.handle(row.event_type, row.payload);
          await m.query(
            `UPDATE message_events_outbox
                SET processed_at = now(), last_error = NULL
              WHERE id = $1`,
            [row.id],
          );
        } catch (e) {
          const attempts = (row.attempts ?? 0) + 1;
          const backoffSec = Math.min(60 * 60, 2 ** attempts);
          await m.query(
            `UPDATE message_events_outbox
                SET attempts = $2,
                    next_attempt_at = now() + ($3 || ' seconds')::interval,
                    last_error = $4
              WHERE id = $1`,
            [row.id, attempts, backoffSec, (e as Error).message?.slice(0, 1000)],
          );
          this.logger.warn(
            `event ${row.id} (${row.event_type}) failed attempt ${attempts} → retry in ${backoffSec}s: ${(e as Error).message}`,
          );
          this.metrics?.count('OutboxFailure', 1, { event_type: row.event_type });
        }
      }
      return rows.length;
    });
  }

  private async handle(type: string, payload: any): Promise<void> {
    switch (type) {
      case 'message.created':
        return this.onMessageCreated(payload);
      case 'message.read':
      case 'conversation.created':
        return;
      default:
        this.logger.warn(`Unknown event_type=${type}`);
    }
  }

  private async onMessageCreated(payload: {
    messageId: string;
    conversationId: string;
    senderId: string;
    sequence: string;
    recipients?: string[];
  }) {
    const recipients = payload.recipients ?? [];
    if (recipients.length === 0) return;
    const online = await this.presence.areOnline(recipients);
    const offline = recipients.filter((r) => !online[r]);
    if (offline.length === 0) return;
    await this.notifications.notifyNewMessage({
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      senderId: payload.senderId,
      recipientIds: offline,
    });
  }
}
