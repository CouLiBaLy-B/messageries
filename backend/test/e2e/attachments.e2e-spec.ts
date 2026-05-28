import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { startInfra, E2eInfra } from '../helpers/containers';
import { buildApp, resetDb } from '../helpers/app';
import { createUser, loginAs, createOrder } from '../helpers/fixtures';

describe('Attachments (e2e)', () => {
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

  it('presign upload → upload S3 → finalize → download URL', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const order = await createOrder(ds, customer.id, seller.id);
    const c = await loginAs(app, customer.email);

    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    // 1. Presign upload
    const fileBody = Buffer.from('Hello attachment world');
    const presign = await request(app.getHttpServer())
      .post('/api/v1/attachments/presign')
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({
        conversationId: conv.body.id,
        filename: 'note.txt',
        mimeType: 'text/plain',
        sizeBytes: fileBody.length,
      })
      .expect(201);

    expect(presign.body.uploadUrl).toMatch(/^https?:\/\//);
    expect(presign.body.attachmentId).toBeTruthy();

    // 2. Upload via fetch direct (PUT signé)
    const putRes = await fetch(presign.body.uploadUrl, {
      method: 'PUT',
      body: fileBody,
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(putRes.ok).toBe(true);

    // 3. Finalize
    await request(app.getHttpServer())
      .post(`/api/v1/attachments/${presign.body.attachmentId}/finalize`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    // 4. Download URL (RBAC OK)
    const dl = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${presign.body.attachmentId}/download-url`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(200);
    const fetched = await fetch(dl.body.url);
    expect(await fetched.text()).toBe('Hello attachment world');
  });

  it('refuse un mimeType non whitelisté', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const order = await createOrder(ds, customer.id, seller.id);
    const c = await loginAs(app, customer.email);
    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/attachments/presign')
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({
        conversationId: conv.body.id,
        filename: 'evil.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 1024,
      })
      .expect(400);
  });

  it('refuse un download par un user non participant', async () => {
    const customer = await createUser(ds, 'customer');
    const seller = await createUser(ds, 'seller');
    const stranger = await createUser(ds, 'customer');
    const order = await createOrder(ds, customer.id, seller.id);
    const c = await loginAs(app, customer.email);

    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    const fileBody = Buffer.from('secret');
    const presign = await request(app.getHttpServer())
      .post('/api/v1/attachments/presign')
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({
        conversationId: conv.body.id,
        filename: 'secret.txt',
        mimeType: 'text/plain',
        sizeBytes: fileBody.length,
      })
      .expect(201);
    await fetch(presign.body.uploadUrl, {
      method: 'PUT',
      body: fileBody,
      headers: { 'Content-Type': 'text/plain' },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/attachments/${presign.body.attachmentId}/finalize`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .expect(201);

    const t = await loginAs(app, stranger.email);
    await request(app.getHttpServer())
      .get(`/api/v1/attachments/${presign.body.attachmentId}/download-url`)
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(403);
  });
});
