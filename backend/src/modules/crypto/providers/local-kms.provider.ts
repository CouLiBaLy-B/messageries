import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { KmsProvider } from '../kms.interface';

/**
 * KMS local pour dev/staging :
 * - KEK = clé symétrique lue depuis env (32 bytes en base64).
 * - Rotation : `KMS_LOCAL_KEYS=id1:base64,id2:base64`, `KMS_LOCAL_ACTIVE=id2`.
 * ⚠️ NE PAS utiliser en prod sans HSM/KMS managé.
 */
export class LocalKmsProvider implements KmsProvider {
  private readonly keys: Map<string, Buffer>;
  private readonly active: string;

  constructor(cfg: ConfigService) {
    const raw = cfg.get<string>('KMS_LOCAL_KEYS');
    if (!raw) {
      // dev fallback : une seule clé dérivée pour ne pas planter
      const dev = randomBytes(32);
      this.keys = new Map([['dev-key-1', dev]]);
      this.active = 'dev-key-1';
      // eslint-disable-next-line no-console
      console.warn('[LocalKmsProvider] KMS_LOCAL_KEYS absent — clé éphémère utilisée (dev only)');
      return;
    }
    this.keys = new Map(
      raw.split(',').map((pair) => {
        const [id, b64] = pair.split(':');
        const buf = Buffer.from(b64, 'base64');
        if (buf.length !== 32) throw new Error(`KMS key ${id} must be 32 bytes`);
        return [id.trim(), buf];
      }),
    );
    this.active = cfg.get<string>('KMS_LOCAL_ACTIVE') ?? Array.from(this.keys.keys()).pop()!;
    if (!this.keys.has(this.active)) throw new Error(`Active key ${this.active} not in KMS_LOCAL_KEYS`);
  }

  activeKeyId(): string {
    return this.active;
  }

  async generateDataKey() {
    const plaintext = randomBytes(32); // DEK 256 bits
    const kek = this.keys.get(this.active)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', kek, iv);
    const wrapped = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    // format : [1B iv.len][iv][1B tag.len][tag][wrapped]
    const ciphertext = Buffer.concat([
      Buffer.from([iv.length]), iv,
      Buffer.from([tag.length]), tag,
      wrapped,
    ]);
    return { keyId: this.active, plaintext, ciphertext };
  }

  async decryptDataKey(keyId: string, ciphertext: Buffer): Promise<Buffer> {
    const kek = this.keys.get(keyId);
    if (!kek) throw new Error(`Unknown KMS key ${keyId}`);
    let off = 0;
    const ivLen = ciphertext.readUInt8(off); off += 1;
    const iv = ciphertext.subarray(off, off + ivLen); off += ivLen;
    const tagLen = ciphertext.readUInt8(off); off += 1;
    const tag = ciphertext.subarray(off, off + tagLen); off += tagLen;
    const wrapped = ciphertext.subarray(off);
    const decipher = createDecipheriv('aes-256-gcm', kek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  }
}
