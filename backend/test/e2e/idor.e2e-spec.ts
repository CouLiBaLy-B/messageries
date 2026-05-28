import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { startInfra, E2eInfra } from '../helpers/containers';
import { buildApp, resetDb } from '../helpers/app';
import { createUser, loginAs, createOrder } from '../helpers/fixtures';

describe('IDOR / authorization (e2e)', () => {
  let infra: E2eInfra;
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    infra = await startInfra();
    const built = await buildApp();
    app = built.app;
    ds = built.ds;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  beforeEach(async () => {
    await resetDb(ds);
  });

  it('un tiers ne peut pas lire une conversation dont il connaît l\'ID', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const stranger = await createUser(ds, 'seller');
    const order = await createOrder(ds, customer.id, seller.id);

    const c = await loginAs(app, customer.email);
    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    const t = await loginAs(app, stranger.email);
    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conv.body.id}`)
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${t.accessToken}`)
      .send({ body: 'inject' })
      .expect(403);
  });

  it('un support peut rejoindre une conversation et l\'accès est audité', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const support = await createUser(ds, 'support');
    const order = await createOrder(ds, customer.id, seller.id);

    const c = await loginAs(app, customer.email);
    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    const sup = await loginAs(app, support.email);
    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conv.body.id}`)
      .set('Authorization', `Bearer ${sup.accessToken}`)
      .expect(200);

    const audit = await ds.query(
      `SELECT action FROM audit_log WHERE target_id = $1 ORDER BY created_at`,
      [conv.body.id],
    );
    const actions = audit.map((a: any) => a.action);
    expect(actions).toContain('conversation.support_joined');
  });

  it('rejette les requêtes non authentifiées', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/conversations')
      .expect(401);
  });
});
