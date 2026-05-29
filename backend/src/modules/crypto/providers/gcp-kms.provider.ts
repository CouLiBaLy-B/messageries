import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { KmsProvider } from '../kms.interface';

/**
 * GCP Cloud KMS provider.
 * Cloud KMS n'a pas d'API "GenerateDataKey" comme AWS KMS → on génère la DEK
 * localement avec randomBytes(32) puis on l'encrypt avec la KEK via Encrypt.
 *
 * Install à ajouter en prod : `npm i @google-cloud/kms`.
 */
export class GcpKmsProvider implements KmsProvider {
  private readonly keyName: string;
  private client: any;

  constructor(cfg: ConfigService) {
    this.keyName = cfg.get<string>('GCP_KMS_KEY_NAME') ?? '';
    if (!this.keyName) {
      throw new Error('GCP_KMS_KEY_NAME requis pour KMS_DRIVER=gcp');
    }
  }

  private async ensureClient() {
    if (this.client) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { KeyManagementServiceClient } = await import('@google-cloud/kms');
      this.client = new KeyManagementServiceClient();
    } catch (e) {
      throw new Error(`@google-cloud/kms requis pour KMS_DRIVER=gcp : ${(e as Error).message}`);
    }
  }

  activeKeyId(): string {
    return this.keyName;
  }

  async generateDataKey(): Promise<{ keyId: string; plaintext: Buffer; ciphertext: Buffer }> {
    await this.ensureClient();
    const plaintext = randomBytes(32); // DEK 256 bits
    const [res] = await this.client.encrypt({
      name: this.keyName,
      plaintext,
    });
    const ciphertext = Buffer.from(res.ciphertext as Uint8Array);
    return { keyId: this.keyName, plaintext, ciphertext };
  }

  async decryptDataKey(_keyId: string, ciphertext: Buffer): Promise<Buffer> {
    await this.ensureClient();
    const [res] = await this.client.decrypt({
      name: this.keyName, // GCP KMS résout la version automatiquement
      ciphertext,
    });
    return Buffer.from(res.plaintext as Uint8Array);
  }
}
