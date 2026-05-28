import { ConfigService } from '@nestjs/config';
import { EnvelopeCryptoService } from './envelope-crypto.service';
import { LocalKmsProvider } from './providers/local-kms.provider';
import { randomBytes } from 'crypto';

describe('EnvelopeCryptoService', () => {
  let svc: EnvelopeCryptoService;

  beforeAll(() => {
    const key1 = randomBytes(32).toString('base64');
    const key2 = randomBytes(32).toString('base64');
    const cfg = new ConfigService({
      KMS_LOCAL_KEYS: `k1:${key1},k2:${key2}`,
      KMS_LOCAL_ACTIVE: 'k2',
    });
    svc = new EnvelopeCryptoService(new LocalKmsProvider(cfg));
  });

  it('chiffre et déchiffre', async () => {
    const enc = await svc.encrypt('Bonjour 👋, où est ma commande ?');
    expect(enc.alg).toBe('aes-256-gcm');
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(enc.dekId).toContain('::');
    const dec = await svc.decrypt({
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      tag: enc.tag,
      dekId: enc.dekId,
    });
    expect(dec).toBe('Bonjour 👋, où est ma commande ?');
  });

  it('échoue si on altère le ciphertext (auth tag invalide)', async () => {
    const enc = await svc.encrypt('secret');
    enc.ciphertext[0] = enc.ciphertext[0] ^ 0xff;
    await expect(
      svc.decrypt({ ...enc, ciphertext: enc.ciphertext }),
    ).rejects.toThrow();
  });

  it('rotation : déchiffre avec clé non-active si dekId indique l\'ancienne', async () => {
    // Reproduit le scénario en créant un service avec clé ancienne, puis on déchiffre avec un service multi-clés
    const oldKey = randomBytes(32).toString('base64');
    const newKey = randomBytes(32).toString('base64');

    const oldOnly = new EnvelopeCryptoService(
      new LocalKmsProvider(new ConfigService({ KMS_LOCAL_KEYS: `old:${oldKey}`, KMS_LOCAL_ACTIVE: 'old' })),
    );
    const enc = await oldOnly.encrypt('vieux message');

    const multi = new EnvelopeCryptoService(
      new LocalKmsProvider(
        new ConfigService({
          KMS_LOCAL_KEYS: `old:${oldKey},new:${newKey}`,
          KMS_LOCAL_ACTIVE: 'new',
        }),
      ),
    );
    const dec = await multi.decrypt(enc);
    expect(dec).toBe('vieux message');
  });
});
