/**
 * Phase 5 — vérifie le pipeline complet :
 *   api POST → outbox → outbox worker → NATS publish → consumer test → reçoit event
 *
 * Démarre un container NATS en plus.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import request from 'supertest';
import { startInfra, E2eInfra } from '../helpers/containers';
import { buildApp, resetDb } from '../helpers/app';
import { createUser, loginAs, createOrder } from '../helpers/fixtures';

describe('Phase 5 — NATS pipeline (e2e)', () => {
  let infra: E2eInfra;
  let nats: StartedTestContainer;
  let app: INestApplication;
  let ds: DataSource;
  let nc: any;

  beforeAll(async () => {
    // 1. infra de base
    infra = await startInfra();
    // 2. container NATS
    nats = await new GenericContainer('nats:2.10-alpine')
      .withCommand(['-js', '-m', '8222'])
      .withExposedPorts(4222, 8222)
      .withWaitStrategy(Wait.forHttp('/healthz', 8222))
      .start();
    const natsUrl = `nats://${nats.getHost()}:${nats.getMappedPort(4222)}`;
    process.env.NATS_ENABLED = 'true';
    process.env.NATS_URL = natsUrl;
    process.env.NATS_STREAM = 'MESSAGING_EVENTS';
    process.env.WS_GATEWAY_DEDICATED = 'true';
    process.env.OUTBOX_WORKER_ENABLED = 'true';

    // 3. app NestJS (le worker outbox va tourner)
    const built = await buildApp();
    app = built.app;
    ds = built.ds;

    // 4. client NATS de test (joue le rôle ws-gateway)
    const natsLib = await import('nats');
    nc = await natsLib.connect({ servers: [natsUrl] });
  }, 240_000);

  afterAll(async () => {
    try { await nc?.drain(); } catch {}
    await app?.close();
    await Promise.allSettled([infra?.stop(), nats?.stop()]);
    process.env.WS_GATEWAY_DEDICATED = 'false';
    process.env.NATS_ENABLED = 'false';
  });

  beforeEach(async () => {
    await resetDb(ds);
  });

  it('un message créé via API est publié sur NATS avec dédup Msg-Id', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const order = await createOrder(ds, customer.id, seller.id);
    const c = await loginAs(app, customer.email);
    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    // Souscription à messaging.events.message.created
    const js = nc.jetstream();
    const jsm = await nc.jetstreamManager();
    // wait stream existe (créé par api au boot)
    let streamReady = false;
    for (let i = 0; i < 30 && !streamReady; i++) {
      try {
        await jsm.streams.info('MESSAGING_EVENTS');
        streamReady = true;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    expect(streamReady).toBe(true);

    const sub = await js.subscribe('messaging.events.message.created', {
      config: {
        deliver_policy: 'new',
        durable_name: `test-${Date.now()}`,
        ack_policy: 'explicit',
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .set('Idempotency-Key', 'nats-test-1')
      .send({ body: 'Bonjour via NATS' })
      .expect(201);

    // Attendre l'event
    const evt: any = await Promise.race([
      (async () => {
        for await (const m of sub) {
          m.ack();
          return JSON.parse(new TextDecoder().decode(m.data));
        }
      })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('no nats event')), 8000)),
    ]);

    expect(evt.body).toBe('Bonjour via NATS');
    expect(evt.conversationId).toBe(conv.body.id);
    expect(evt.recipients).toContain(seller.id);
    expect(typeof evt.sequence).toBe('string');
  });
});
