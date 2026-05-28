import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { io as ioc, Socket } from 'socket.io-client';
import { RedisIoAdapter } from '../../src/modules/realtime/redis-io.adapter';
import { startInfra, E2eInfra } from '../helpers/containers';
import { buildApp, resetDb } from '../helpers/app';
import { createUser, loginAs, createOrder } from '../helpers/fixtures';

describe('Realtime WS (e2e)', () => {
  let infra: E2eInfra;
  let app: INestApplication;
  let ds: DataSource;
  let baseUrl: string;

  beforeAll(async () => {
    infra = await startInfra();
    const built = await buildApp();
    app = built.app;
    ds = built.ds;
    const adapter = new RedisIoAdapter(app);
    await adapter.connectToRedis(infra.env.REDIS_HOST, Number(infra.env.REDIS_PORT));
    app.useWebSocketAdapter(adapter);
    await app.listen(0);
    const url = await app.getUrl();
    baseUrl = url.replace('[::1]', 'localhost').replace('127.0.0.1', 'localhost');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  beforeEach(async () => {
    await resetDb(ds);
  });

  async function connect(token: string): Promise<Socket> {
    const sock = ioc(`${baseUrl}/ws`, {
      transports: ['websocket'],
      auth: { token },
      extraHeaders: { Origin: 'http://localhost' },
      autoConnect: true,
      reconnection: false,
    });
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('WS connect timeout')), 5000);
      sock.on('connect', () => { clearTimeout(t); res(); });
      sock.on('connect_error', (e) => { clearTimeout(t); rej(e); });
    });
    return sock;
  }

  it('seller reçoit le message du customer en temps réel', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const order = await createOrder(ds, customer.id, seller.id);
    const c = await loginAs(app, customer.email);
    const s = await loginAs(app, seller.email);

    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    const sellerSock = await connect(s.accessToken);
    const joinAck = await new Promise<any>((res) =>
      sellerSock.emit('conversation.join', { conversationId: conv.body.id }, res),
    );
    expect(joinAck.ok).toBe(true);

    const received = new Promise<any>((res) => sellerSock.once('message.created', res));

    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({ body: 'Salut vendeur' })
      .expect(201);

    const evt = await Promise.race([
      received,
      new Promise((_, rej) => setTimeout(() => rej(new Error('no event')), 5000)),
    ]);
    expect((evt as any).body).toBe('Salut vendeur');

    sellerSock.disconnect();
  });

  it('refuse le join d\'un user non participant', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const stranger = await createUser(ds, 'seller');
    const order = await createOrder(ds, customer.id, seller.id);
    const c = await loginAs(app, customer.email);
    const t = await loginAs(app, stranger.email);
    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    const sock = await connect(t.accessToken);
    const ack = await new Promise<any>((res) =>
      sock.emit('conversation.join', { conversationId: conv.body.id }, res),
    );
    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('forbidden');
    sock.disconnect();
  });
});
