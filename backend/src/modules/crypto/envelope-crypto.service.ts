import { Inject, Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { KMS_PROVIDER, KmsProvider } from './kms.interface';

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  alg: 'aes-256-gcm';
  dekId: string; // = wrapped DEK encodée base64 + ":" + keyId KEK
}

/**
 * Envelope encryption :
 *  - 1 DEK aléatoire par message (256 bits)
 *  - DEK wrappée par la KEK du KMS (rotation possible)
 *  - body chiffré en AES-256-GCM (auth)
 *  - on persiste { ciphertext, iv, tag, dekId } où dekId encode aussi la KEK utilisée
 *  → permet de rotater la KEK sans réécrire toute la base.
 */
@Injectable()
export class EnvelopeCryptoService {
  private readonly logger = new Logger(EnvelopeCryptoService.name);
  // Cache LRU minimal des DEK déchiffrées (clé = dekId, valeur = Buffer)
  private readonly dekCache = new Map<string, { dek: Buffer; expires: number }>();
  private readonly cacheTtlMs = 60_000;

  constructor(@Inject(KMS_PROVIDER) private readonly kms: KmsProvider) {}

  async encrypt(plaintext: string): Promise<EncryptedPayload> {
    const { keyId, plaintext: dek, ciphertext: wrappedDek } = await this.kms.generateDataKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // wipe DEK ASAP
    dek.fill(0);
    const dekId = `${keyId}::${wrappedDek.toString('base64')}`;
    return { ciphertext: ct, iv, tag, alg: 'aes-256-gcm', dekId };
  }

  async decrypt(payload: {
    ciphertext: Buffer;
    iv: Buffer;
    tag: Buffer;
    dekId: string;
  }): Promise<string> {
    const dek = await this.unwrap(payload.dekId);
    const decipher = createDecipheriv('aes-256-gcm', dek, payload.iv);
    decipher.setAuthTag(payload.tag);
    const pt = Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
    return pt.toString('utf8');
  }

  private async unwrap(dekId: string): Promise<Buffer> {
    const cached = this.dekCache.get(dekId);
    if (cached && cached.expires > Date.now()) return cached.dek;
    const [keyId, b64] = dekId.split('::');
    const wrapped = Buffer.from(b64, 'base64');
    const dek = await this.kms.decryptDataKey(keyId, wrapped);
    if (this.dekCache.size > 5000) this.dekCache.clear();
    this.dekCache.set(dekId, { dek, expires: Date.now() + this.cacheTtlMs });
    return dek;
  }
}
