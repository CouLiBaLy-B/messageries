import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { startInfra, E2eInfra } from '../helpers/containers';
import { buildApp, resetDb } from '../helpers/app';
import { createUser, loginAs, createOrder } from '../helpers/fixtures';

describe('Privacy / RGPD (e2e)', () => {
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

  it('export inclut les messages déchiffrés du user', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const order = await createOrder(ds, customer.id, seller.id);
    const c = await loginAs(app, customer.email);

    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({ body: 'Ma question 42' })
      .expect(201);

    const exp = await request(app.getHttpServer())
      .get('/api/v1/me/data/export')
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(200);

    expect(exp.body.user.id).toBe(customer.id);
    expect(exp.body.messages).toHaveLength(1);
    expect(exp.body.messages[0].body).toBe('Ma question 42');
  });

  it('anonymisation : wipe body, user pseudo, refresh tokens révoqués', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const order = await createOrder(ds, customer.id, seller.id);
    const c = await loginAs(app, customer.email);

    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({ body: 'à supprimer' })
      .expect(201);

    await request(app.getHttpServer())
      .delete('/api/v1/me/data')
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(204);

    const userRow = await ds.query(`SELECT email, anonymized_at, is_suspended FROM users WHERE id = $1`, [customer.id]);
    expect(userRow[0].email).toContain('anon_');
    expect(userRow[0].anonymized_at).not.toBeNull();
    expect(userRow[0].is_suspended).toBe(true);

    const msgRow = await ds.query(`SELECT body, body_ciphertext, status FROM messages WHERE sender_id = $1`, [customer.id]);
    expect(msgRow[0].body).toBeNull();
    expect(msgRow[0].body_ciphertext).toBeNull();
    expect(msgRow[0].status).toBe('deleted');

    const rt = await ds.query(`SELECT revoked_at FROM refresh_tokens WHERE user_id = $1`, [customer.id]);
    expect(rt.every((r: any) => r.revoked_at !== null)).toBe(true);
  });
});
