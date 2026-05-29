/**
 * E2E driver STORAGE_DRIVER=gcs avec fake-gcs-server.
 *
 * On vérifie :
 *   1. presign PUT (URL fake-gcs)
 *   2. upload via fetch
 *   3. finalize + head OK
 *   4. download URL + récupération du contenu
 *   5. RBAC : un user non-participant reçoit 403
 *
 * Pré-requis : Docker. Le test installe @google-cloud/storage (optionalDep).
 *
 * Skip si la dep n'est pas installée (mode CI minimaliste).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { startInfra, E2eInfra } from '../helpers/containers';
import { startFakeGcs, StartedFakeGcs } from '../helpers/gcs-container';
import { buildApp, resetDb } from '../helpers/app';
import { createUser, loginAs, createOrder } from '../helpers/fixtures';

let gcsAvailable = true;
try {
  require.resolve('@google-cloud/storage');
} catch {
  gcsAvailable = false;
}

(gcsAvailable ? describe : describe.skip)(
  'Phase GCP — Attachments via GCS (e2e)',
  () => {
    let infra: E2eInfra;
    let fakeGcs: StartedFakeGcs;
    let app: INestApplication;
    let ds: DataSource;

    beforeAll(async () => {
      infra = await startInfra();
      fakeGcs = await startFakeGcs('messaging-test');

      // Switch storage driver à GCS
      process.env.STORAGE_DRIVER = 'gcs';
      process.env.GCS_BUCKET = fakeGcs.bucket;
      process.env.GCS_ENDPOINT = fakeGcs.endpoint;
      process.env.GCP_PROJECT_ID = 'test-project';
      process.env.GCS_SIGNED_URL_BYPASS = 'true';

      const built = await buildApp();
      app = built.app;
      ds = built.ds;
    }, 240_000);

    afterAll(async () => {
      await app?.close();
      await Promise.allSettled([infra?.stop(), fakeGcs?.stop()]);
      // Restore defaults pour ne pas polluer les autres tests
      process.env.STORAGE_DRIVER = 's3';
      delete process.env.GCS_BUCKET;
      delete process.env.GCS_ENDPOINT;
      delete process.env.GCP_PROJECT_ID;
      delete process.env.GCS_SIGNED_URL_BYPASS;
    });

    beforeEach(async () => {
      await resetDb(ds);
    });

    it('presign → upload → finalize → download via fake-gcs', async () => {
      const customer = await createUser(ds, 'customer');
      const seller = await createUser(ds, 'seller');
      const order = await createOrder(ds, customer.id, seller.id);
      const c = await loginAs(app, customer.email);

      const conv = await request(app.getHttpServer())
        .post(`/api/v1/conversations/by-order/${order.id}`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(201);

      const fileBody = Buffer.from('Hello GCS — test attachment');
      const presign = await request(app.getHttpServer())
        .post('/api/v1/attachments/presign')
        .set('Authorization', `Bearer ${c.accessToken}`)
        .send({
          conversationId: conv.body.id,
          filename: 'note-gcs.txt',
          mimeType: 'text/plain',
          sizeBytes: fileBody.length,
        })
        .expect(201);

      // L'URL bypass pointe vers fake-gcs
      expect(presign.body.uploadUrl).toContain(fakeGcs.endpoint);
      expect(presign.body.uploadUrl).toContain('uploadType=media');

      // Upload via fetch direct
      const putRes = await fetch(presign.body.uploadUrl, {
        method: 'POST', // fake-gcs accepte POST avec uploadType=media (multipart-style)
        body: fileBody,
        headers: { 'Content-Type': 'text/plain' },
      });
      expect(putRes.ok).toBe(true);

      // Finalize (head check côté serveur)
      await request(app.getHttpServer())
        .post(`/api/v1/attachments/${presign.body.attachmentId}/finalize`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(201);

      // Download URL
      const dl = await request(app.getHttpServer())
        .get(`/api/v1/attachments/${presign.body.attachmentId}/download-url`)
        .set('Authorization', `Bearer ${c.accessToken}`)
        .expect(200);

      const fetched = await fetch(dl.body.url);
      expect(fetched.ok).toBe(true);
      const text = await fetched.text();
      expect(text).toBe('Hello GCS — test attachment');
    });

    it('refuse mimeType non whitelisté', async () => {
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

    it('refuse download par non-participant (RBAC)', async () => {
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
        method: 'POST',
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
  },
);
