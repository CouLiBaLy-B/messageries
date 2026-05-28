import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { startInfra, E2eInfra } from '../helpers/containers';
import { buildApp, resetDb } from '../helpers/app';
import { createUser } from '../helpers/fixtures';

/**
 * Phase 2 sécurité : rotation refresh + détection de replay
 * → toute la famille révoquée.
 */
describe('Refresh token rotation & replay detection (e2e)', () => {
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

  function getCookie(cookies: string[], name: string): string | undefined {
    for (const c of cookies) {
      const m = new RegExp(`(?:^|; )${name}=([^;]+)`).exec(c);
      if (m) return m[1];
    }
    return undefined;
  }

  it('rotate puis re-use de l\'ancien refresh → 403 + famille révoquée', async () => {
    const user = await createUser(ds, 'customer');

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Password1234!' })
      .expect(200);

    const originalRefresh = getCookie(login.headers['set-cookie'] as any, 'refresh_token')!;
    expect(originalRefresh).toBeTruthy();

    // 1. Rotation OK
    const rot1 = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: originalRefresh })
      .expect(200);
    const newRefresh = getCookie(rot1.headers['set-cookie'] as any, 'refresh_token')!;
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(originalRefresh);

    // 2. Replay → 403
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: originalRefresh })
      .expect(403);

    // 3. Le NOUVEAU token est aussi révoqué (famille compromise)
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: newRefresh })
      .expect(403);

    // 4. En base : tous les tokens du user ont revoked_at
    const rows = await ds.query(
      `SELECT revoked_at, revoked_reason FROM refresh_tokens WHERE user_id = $1`,
      [user.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.revoked_at).not.toBeNull();
    }
    expect(rows.some((r: any) => r.revoked_reason === 'family_compromise')).toBe(true);
  });
});
