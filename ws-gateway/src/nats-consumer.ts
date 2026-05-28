import { connect, NatsConnection, JsMsg, AckPolicy, DeliverPolicy } from 'nats';
import { logger } from './logger';

export interface MessageCreatedEvent {
  messageId: string;
  conversationId: string;
  senderId: string;
  sequence: string;
  createdAt: string;
  body?: string;
  moderationFlags?: string[];
  recipients?: string[];
}

export type EventHandler = (subject: string, data: any) => Promise<void>;

export class NatsConsumer {
  private nc?: NatsConnection;

  async start(opts: {
    servers: string;
    stream: string;
    durable: string;
    onEvent: EventHandler;
  }) {
    this.nc = await connect({
      servers: opts.servers.split(','),
      reconnect: true,
      maxReconnectAttempts: -1,
    });
    const js = this.nc.jetstream();
    const jsm = await this.nc.jetstreamManager();

    // S'assure que le consumer durable existe (idempotent)
    try {
      await jsm.consumers.info(opts.stream, opts.durable);
    } catch {
      await jsm.consumers.add(opts.stream, {
        durable_name: opts.durable,
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.New,
        filter_subject: 'messaging.events.>',
        max_deliver: 10,
        ack_wait: 30 * 1_000_000_000, // 30s
      });
      logger.info({ stream: opts.stream, durable: opts.durable }, 'jetstream consumer created');
    }

    const consumer = await js.consumers.get(opts.stream, opts.durable);
    const sub = await consumer.consume();
    logger.info({ stream: opts.stream }, 'consuming events');

    (async () => {
      for await (const m of sub as AsyncIterable<JsMsg>) {
        try {
          const data = JSON.parse(new TextDecoder().decode(m.data));
          // subject: messaging.events.message.created → on retire le prefix
          const eventType = m.subject.replace(/^messaging\.events\./, '');
          await opts.onEvent(eventType, data);
          m.ack();
        } catch (e) {
          logger.error({ err: (e as Error).message, subject: m.subject }, 'event handler failed');
          // nak avec délai pour retry
          m.nak(2_000);
        }
      }
    })().catch((e) => logger.error({ err: e.message }, 'consume loop crashed'));
  }

  async stop() {
    await this.nc?.drain();
  }
}
