import { ConfigService } from '@nestjs/config';
import { KmsProvider } from '../kms.interface';

/**
 * AWS KMS provider — utilisé en prod.
 * Le SDK est lazy-loaded pour éviter de l'imposer en dev.
 *
 * Install à ajouter en prod : `npm i @aws-sdk/client-kms`.
 */
export class AwsKmsProvider implements KmsProvider {
  private readonly keyArn: string;
  private readonly region: string;
  private client: any;

  constructor(cfg: ConfigService) {
    this.keyArn = cfg.get<string>('AWS_KMS_KEY_ARN') ?? '';
    this.region = cfg.get<string>('AWS_REGION', 'eu-west-3');
    if (!this.keyArn) throw new Error('AWS_KMS_KEY_ARN requis pour KMS_DRIVER=aws');
  }

  private async ensureClient() {
    if (this.client) return;
    const sdk = await import('@aws-sdk/client-kms').catch((e) => {
      throw new Error(`@aws-sdk/client-kms requis pour KMS_DRIVER=aws : ${e.message}`);
    });
    this.client = {
      sdk,
      instance: new sdk.KMSClient({ region: this.region }),
    };
  }

  activeKeyId(): string {
    return this.keyArn;
  }

  async generateDataKey(): Promise<{ keyId: string; plaintext: Buffer; ciphertext: Buffer }> {
    await this.ensureClient();
    const out = await this.client.instance.send(
      new this.client.sdk.GenerateDataKeyCommand({
        KeyId: this.keyArn,
        KeySpec: 'AES_256',
      }),
    );
    return {
      keyId: this.keyArn,
      plaintext: Buffer.from(out.Plaintext as Uint8Array),
      ciphertext: Buffer.from(out.CiphertextBlob as Uint8Array),
    };
  }

  async decryptDataKey(keyId: string, ciphertext: Buffer): Promise<Buffer> {
    await this.ensureClient();
    const out = await this.client.instance.send(
      new this.client.sdk.DecryptCommand({
        KeyId: keyId,
        CiphertextBlob: ciphertext,
      }),
    );
    return Buffer.from(out.Plaintext as Uint8Array);
  }
}
