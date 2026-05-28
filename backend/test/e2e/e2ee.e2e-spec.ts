/**
 * Phase 8 — vérifie le transport MLS opaque côté serveur :
 *  - publish KeyPackages
 *  - claim KeyPackage (consume + lock)
 *  - enable E2EE → groupe créé, welcomes persistés
 *  - send MLS message (commit) → epoch bump
 *  - list MLS → only target_user voit son welcome
 *  - envoi classique POST /messages refusé sur conv E2EE
 *
 * On NE FAIT PAS de vraie crypto MLS dans ce test : tous les "ciphertexts"
 * sont des bytes random. Le serveur ne déchiffre pas.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomBytes } from 'crypto';
import { startInfra, E2eInfra } from '../helpers/containers';
import { buildApp, resetDb } from '../helpers/app';
import { createUser, loginAs, createOrder } from '../helpers/fixtures';

const b64 = (n = 32) => randomBytes(n).toString('base64');

describe('Phase 8 — E2EE MLS transport (e2e)', () => {
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

  it('publish + claim KeyPackages', async () => {
    const u = await createUser(ds, 'customer');
    const peer = await createUser(ds, 'seller');
    const t = await loginAs(app, u.email);
    const tp = await loginAs(app, peer.email);

    // u publie 3 KP
    await request(app.getHttpServer())
      .post('/api/v1/e2ee/key-packages')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .send({
        deviceId: 'dev-1',
        cipherSuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
        keyPackages: [b64(), b64(), b64()],
      })
      .expect(201);

    // peer claim un KP de u
    const claim = await request(app.getHttpServer())
      .post(`/api/v1/e2ee/key-packages/claim/${u.id}`)
      .query({ cipherSuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519' })
      .set('Authorization', `Bearer ${tp.accessToken}`)
      .expect(201);
    expect(typeof claim.body.keyPackage).toBe('string');
    expect(claim.body.deviceId).toBe('dev-1');

    // count : il en reste 2
    const cnt = await request(app.getHttpServer())
      .get('/api/v1/e2ee/key-packages/count')
      .query({ cipherSuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519' })
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(200);
    expect(cnt.body).toBe(2);
  });

  it('enable E2EE + welcome ciblé + commit + refus envoi classique', async () => {
    const c = await createUser(ds, 'customer');
    const s = await createUser(ds, 'seller');
    const order = await createOrder(ds, c.id, s.id);
    const cTok = await loginAs(app, c.email);
    const sTok = await loginAs(app, s.email);
    const conv = await request(app.getHttpServer())
      .post(`/api/v1/conversations/by-order/${order.id}`)
      .set('Authorization', `Bearer ${cTok.accessToken}`)
      .expect(201);

    // Activer E2EE
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/e2ee/enable`)
      .set('Authorization', `Bearer ${cTok.accessToken}`)
      .send({
        groupIdMls: b64(16),
        cipherSuite: 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
        welcomeMessages: [
          { targetUserId: s.id, ciphertext: b64(128), senderDeviceId: 'dev-c' },
        ],
      })
      .expect(201);

    // Envoi classique → refusé
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/messages`)
      .set('Authorization', `Bearer ${cTok.accessToken}`)
      .send({ body: 'hello en clair' })
      .expect(403);

    // Envoi MLS commit
    const sent = await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conv.body.id}/e2ee/messages`)
      .set('Authorization', `Bearer ${cTok.accessToken}`)
      .send({
        kind: 'commit',
        epoch: '0',
        ciphertext: b64(256),
        senderDeviceId: 'dev-c',
      })
      .expect(201);
    expect(sent.body.sequence).toBe('2'); // welcome was seq 1

    // Seller list : doit voir le welcome + le commit
    const list = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conv.body.id}/e2ee/messages`)
      .set('Authorization', `Bearer ${sTok.accessToken}`)
      .expect(200);
    const kinds = list.body.map((m: any) => m.kind);
    expect(kinds).toEqual(expect.arrayContaining(['welcome', 'commit']));

    // Customer list : commit visible, welcome target_user_id=seller donc NON
    const listC = await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conv.body.id}/e2ee/messages`)
      .set('Authorization', `Bearer ${cTok.accessToken}`)
      .expect(200);
    const kindsC = listC.body.map((m: any) => m.kind);
    expect(kindsC).toContain('commit');
    expect(kindsC).not.toContain('welcome');
  });
});
