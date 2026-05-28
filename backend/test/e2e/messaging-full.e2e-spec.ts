import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { startInfra, E2eInfra } from '../helpers/containers';
import { buildApp, resetDb } from '../helpers/app';
import { createUser, loginAs, createOrder } from '../helpers/fixtures';

describe('Messaging — full lifecycle (e2e)', () => {
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

  it('crée une conversation par order et permet l\'échange complet', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const order = await createOrder(ds, customer.id, seller.id);

    const c = await loginAs(app, customer.email);
    const s = await loginAs(app, seller.email);

    // 1. Customer crée la conversation par order
    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);
    expect(conv.body.orderId).toBe(order.id);

    // 2. Re-création idempotente : même conversation_id renvoyé
    const conv2 = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${s.accessToken}`)
      .expect(201);
    expect(conv2.body.id).toBe(conv.body.id);

    // 3. Customer envoie un message
    const m1 = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .set('Idempotency-Key', 'idem-1')
      .send({ body: 'Bonjour, quand sera expédiée ma commande ?' })
      .expect(201);
    expect(m1.body.sequence).toBe('1');
    expect(m1.body.body).toContain('Bonjour');

    // 4. Idempotency : même Idempotency-Key → renvoie le MÊME message
    const m1bis = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .set('Idempotency-Key', 'idem-1')
      .send({ body: 'autre contenu — doit être ignoré' })
      .expect(201);
    expect(m1bis.body.id).toBe(m1.body.id);

    // 5. Seller list messages et voit celui du customer
    const list = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${s.accessToken}`)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].body).toContain('Bonjour');

    // 6. Sequence monotone : seller envoie sa réponse → sequence=2
    const m2 = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${s.accessToken}`)
      .set('Idempotency-Key', 'idem-seller-1')
      .send({ body: 'Demain matin' })
      .expect(201);
    expect(m2.body.sequence).toBe('2');

    // 7. Mark read par customer
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/messages/read`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({ uptoSequence: '2' })
      .expect(204);
  });

  it('chiffre le body en base (envelope encryption)', async () => {
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
      .send({ body: 'Texte ultra confidentiel' })
      .expect(201);

    const row = await ds.query(
      `SELECT body, body_ciphertext, body_iv, body_tag, body_alg, body_dek_id
         FROM messages WHERE conversation_id = $1`,
      [conv.body.id],
    );
    expect(row[0].body).toBeNull();
    expect(row[0].body_ciphertext).toBeTruthy();
    expect(row[0].body_alg).toBe('aes-256-gcm');
    expect(row[0].body_dek_id).toContain('::');
    expect(Buffer.from(row[0].body_ciphertext).toString('utf8')).not.toContain('confidentiel');
  });

  it('redacte automatiquement les données sensibles (PAN, IBAN, CVV)', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const order = await createOrder(ds, customer.id, seller.id);
    const c = await loginAs(app, customer.email);
    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    const sent = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({
        body:
          'Ma carte 4242 4242 4242 4242, cvv: 123, IBAN FR7630006000011234567890189',
      })
      .expect(201);

    expect(sent.body.body).toContain('[REDACTED_PAN]');
    expect(sent.body.body).toContain('[REDACTED_CVV]');
    expect(sent.body.body).toContain('[REDACTED_IBAN]');
    expect(sent.body.body).not.toMatch(/4242 4242/);
    expect(sent.body.moderationFlags).toEqual(
      expect.arrayContaining(['pan', 'iban', 'cvv']),
    );
  });
});
