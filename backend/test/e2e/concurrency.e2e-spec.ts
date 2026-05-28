import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { startInfra, E2eInfra } from '../helpers/containers';
import { buildApp, resetDb } from '../helpers/app';
import { createUser, loginAs, createOrder } from '../helpers/fixtures';

/**
 * Test critique :
 *  - 50 envois concurrents → sequence est monotone et unique
 *  - même Idempotency-Key envoyée 10× en parallèle → 1 seul message créé
 */
describe('Concurrency (e2e)', () => {
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

  it('50 messages concurrents → sequences uniques et continues', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const order = await createOrder(ds, customer.id, seller.id);
    const c = await loginAs(app, customer.email);
    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    const N = 50;
    const sends = Array.from({ length: N }, (_, i) =>
      request(app.getHttpServer())
        .post(`/api/v1/conversations/${conv.body.id}/messages`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .set('Idempotency-Key', `idem-${i}`)
        .send({ body: `Message ${i}` }),
    );
    const results = await Promise.all(sends);
    const seqs = results.map((r) => Number(r.body.sequence)).sort((a, b) => a - b);

    expect(new Set(seqs).size).toBe(N);
    expect(seqs[0]).toBe(1);
    expect(seqs[N - 1]).toBe(N);
  });

  it('même Idempotency-Key 10× en parallèle → 1 seul message', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const order = await createOrder(ds, customer.id, seller.id);
    const c = await loginAs(app, customer.email);
    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    const key = 'same-key';
    const sends = Array.from({ length: 10 }, () =>
      request(app.getHttpServer())
        .post(`/api/v1/conversations/${conv.body.id}/messages`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .set('Idempotency-Key', key)
        .send({ body: 'unique' }),
    );
    const results = await Promise.all(sends);
    const ids = new Set(results.filter((r) => r.status === 201).map((r) => r.body.id));
    // Sous lock + index unique : au pire qq 409, mais ≤1 id distinct créé
    expect(ids.size).toBe(1);

    const rows = await ds.query(`SELECT count(*)::int AS c FROM messages WHERE conversation_id = $1`, [conv.body.id]);
    expect(rows[0].c).toBe(1);
  });
});
