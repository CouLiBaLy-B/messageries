import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Wrapper NATS JetStream pour publication d'events depuis l'outbox worker.
 *
 *  - Conn unique au démarrage.
 *  - Stream "MESSAGING_EVENTS" auto-créé si absent (subjects: messaging.events.>).
 *  - Publish avec Msg-Id = outbox event id → JetStream dédoublonne (window 2 min).
 *  - No-op si NATS_ENABLED=false (fallback Redis Pub/Sub legacy).
 */
@Injectable()
export class NatsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NatsService.name);
  private readonly enabled: boolean;
  private nc: any;
  private js: any;
  private jsm: any;
  private nats: any;

  constructor(private readonly cfg: ConfigService) {
    this.enabled = cfg.get<boolean>('NATS_ENABLED', false);
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('NATS disabled (NATS_ENABLED=false)');
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.nats = require('nats');
      const servers = this.cfg
        .get<string>('NATS_URL', 'nats://localhost:4222')
        .split(',');
      this.nc = await this.nats.connect({
        servers,
        token: this.cfg.get<string>('NATS_TOKEN') || undefined,
        user: this.cfg.get<string>('NATS_USER') || undefined,
        pass: this.cfg.get<string>('NATS_PASSWORD') || undefined,
        tls: this.cfg.get<boolean>('NATS_TLS', false) ? {} : undefined,
        reconnect: true,
        maxReconnectAttempts: -1,
      });
      this.jsm = await this.nc.jetstreamManager();
      this.js = this.nc.jetstream();
      await this.ensureStream();
      this.logger.log(`NATS connected → ${servers.join(',')}`);
    } catch (e) {
      this.logger.warn(`NATS init failed (install 'nats'): ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    try {
      await this.nc?.drain();
    } catch {
      /* noop */
    }
  }

  private async ensureStream() {
    const name = this.cfg.get<string>('NATS_STREAM', 'MESSAGING_EVENTS');
    try {
      await this.jsm.streams.info(name);
    } catch {
      await this.jsm.streams.add({
        name,
        subjects: ['messaging.events.>'],
        retention: 'limits',
        max_age: 7 * 24 * 60 * 60 * 1_000_000_000, // 7 jours en nanosecondes
        storage: 'file',
        num_replicas: this.cfg.get<number>('NATS_REPLICAS', 1),
        duplicate_window: 120 * 1_000_000_000, // 2 min dédup window
      });
      this.logger.log(`Stream ${name} created`);
    }
  }

  /**
   * Publie un event sur "messaging.events.<type>" avec Msg-Id pour dédup.
   * Retourne true si publié, false si NATS désactivé.
   */
  async publish(
    eventType: string,
    payload: Record<string, unknown>,
    msgId: string,
  ): Promise<boolean> {
    if (!this.js) return false;
    const subject = `messaging.events.${eventType}`;
    const data = Buffer.from(JSON.stringify(payload));
    const headers = this.nats.headers();
    headers.set('Nats-Msg-Id', msgId);
    await this.js.publish(subject, data, { headers });
    return true;
  }

  isEnabled(): boolean {
    return this.enabled && !!this.js;
  }
}
