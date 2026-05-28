/**
 * Phase 6 — Search opt-in + RBAC filtering.
 * Lance OpenSearch dans Testcontainers.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { startInfra, E2eInfra } from '../helpers/containers';
import { buildApp, resetDb } from '../helpers/app';
import { createUser, loginAs, createOrder } from '../helpers/fixtures';

describe('Phase 6 — Search (e2e)', () => {
  let infra: E2eInfra;
  let os: StartedTestContainer;
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    infra = await startInfra();
    os = await new GenericContainer('opensearchproject/opensearch:2.13.0')
      .withEnvironment({
        'discovery.type': 'single-node',
        'OPENSEARCH_INITIAL_ADMIN_PASSWORD': 'S3cur3Pass!',
        'plugins.security.disabled': 'false',
      })
      .withExposedPorts(9200)
      .withWaitStrategy(Wait.forLogMessage(/started|recovered/i, 1))
      .withStartupTimeout(180_000)
      .start();

    process.env.SEARCH_ENABLED = 'true';
    process.env.OPENSEARCH_ENDPOINT = `https://${os.getHost()}:${os.getMappedPort(9200)}`;
    process.env.OPENSEARCH_USERNAME = 'admin';
    process.env.OPENSEARCH_PASSWORD = 'S3cur3Pass!';
    process.env.OPENSEARCH_VERIFY_TLS = 'false';
    process.env.OUTBOX_WORKER_ENABLED = 'true';

    const built = await buildApp();
    app = built.app;
    ds = built.ds;
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await Promise.allSettled([infra?.stop(), os?.stop()]);
    process.env.SEARCH_ENABLED = 'false';
  });

  beforeEach(async () => {
    await resetDb(ds);
  });

  it('enable + search RBAC : ne renvoie que mes conversations', async () => {
    const c = await createUser(ds, 'customer');
    const s = await createUser(ds, 'seller');
    const c2 = await createUser(ds, 'customer');
    const s2 = await createUser(ds, 'seller');
    const o1 = await createOrder(ds, c.id, s.id);
    const o2 = await createOrder(ds, c2.id, s2.id);

    const cTok = await loginAs(app, c.email);
    const c2Tok = await loginAs(app, c2.email);

    const conv1 = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${o1.id}`)
      .set('Authorization', `Bearer ${cTok.accessToken}`)
      .expect(201);
    const conv2 = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${o2.id}`)
      .set('Authorization', `Bearer ${c2Tok.accessToken}`)
      .expect(201);

    // Enable search sur conv1 seulement
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv1.body.id}/search/enable`)
      .set('Authorization', `Bearer ${cTok.accessToken}`)
      .expect(201);

    // Envoie des messages
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv1.body.id}/messages`)
      .set('Authorization', `Bearer ${cTok.accessToken}`)
      .send({ body: 'livraison demain matin' }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv2.body.id}/messages`)
      .set('Authorization', `Bearer ${c2Tok.accessToken}`)
      .send({ body: 'livraison perdue' }).expect(201);

    // Attendre indexation async
    await new Promise((r) => setTimeout(r, 3000));

    // c cherche "livraison" → ne voit que conv1
    const res = await request(app.getHttpServer())
      .get('/api/v1/search?q=livraison')
      .set('Authorization', `Bearer ${cTok.accessToken}`)
      .expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    for (const h of res.body.hits) {
      expect(h.conversationId).toBe(conv1.body.id);
    }

    // c2 cherche "livraison" → conv2 non indexée donc 0 résultat
    const res2 = await request(app.getHttpServer())
      .get('/api/v1/search?q=livraison')
      .set('Authorization', `Bearer ${c2Tok.accessToken}`)
      .expect(200);
    expect(res2.body.total).toBe(0);
  });
});
