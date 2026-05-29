import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObjectHead, ObjectStorageService } from './object-storage.interface';

/**
 * Google Cloud Storage adapter.
 * Lazy import @google-cloud/storage pour ne pas imposer la dep en dev S3.
 *
 * Test mode :
 *  - GCS_ENDPOINT (ex: http://fake-gcs:4443) bascule sur fake-gcs-server
 *  - GCS_SIGNED_URL_BYPASS=true génère des URLs directes non-signées
 *    (fake-gcs n'a pas de service account key valide pour signer)
 */
@Injectable()
export class GcsStorageService implements ObjectStorageService {
  private readonly logger = new Logger(GcsStorageService.name);
  private readonly bucketName: string;
  private readonly endpoint?: string;
  private readonly projectId?: string;
  private readonly bypassSign: boolean;
  private storage: any;
  private bucket: any;

  constructor(private readonly cfg: ConfigService) {
    this.bucketName = cfg.get<string>('GCS_BUCKET')!;
    if (!this.bucketName) {
      throw new Error('GCS_BUCKET required when STORAGE_DRIVER=gcs');
    }
    this.endpoint = cfg.get<string>('GCS_ENDPOINT') || undefined;
    this.projectId = cfg.get<string>('GCP_PROJECT_ID') || undefined;
    this.bypassSign = cfg.get<boolean>('GCS_SIGNED_URL_BYPASS', false);
  }

  private async client() {
    if (this.bucket) return this.bucket;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Storage } = await import('@google-cloud/storage');
      this.storage = new Storage({
        ...(this.endpoint ? { apiEndpoint: this.endpoint } : {}),
        ...(this.projectId ? { projectId: this.projectId } : {}),
      });
      this.bucket = this.storage.bucket(this.bucketName);
      return this.bucket;
    } catch (e) {
      throw new Error(
        `@google-cloud/storage requis pour STORAGE_DRIVER=gcs : ${(e as Error).message}`,
      );
    }
  }

  /** URL directe vers fake-gcs-server pour tests (non-signée, pas de TTL réelle). */
  private bypassedUrl(key: string, query: string = ''): string {
    return `${this.endpoint}/upload/storage/v1/b/${this.bucketName}/o?uploadType=media&name=${encodeURIComponent(key)}${query}`;
  }

  private bypassedGetUrl(key: string): string {
    return `${this.endpoint}/storage/v1/b/${this.bucketName}/o/${encodeURIComponent(key)}?alt=media`;
  }

  async presignPut(key: string, mimeType: string, maxBytes: number, ttlSec = 300) {
    if (this.bypassSign && this.endpoint) {
      return this.bypassedUrl(key);
    }
    const bucket = await this.client();
    const [url] = await bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + ttlSec * 1000,
      contentType: mimeType,
      extensionHeaders: {
        'x-goog-content-length-range': `0,${maxBytes}`,
      },
    });
    return url;
  }

  async presignGet(key: string, ttlSec = 60, downloadFilename?: string) {
    if (this.bypassSign && this.endpoint) {
      return this.bypassedGetUrl(key);
    }
    const bucket = await this.client();
    const [url] = await bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + ttlSec * 1000,
      ...(downloadFilename
        ? {
            responseDisposition: `attachment; filename="${encodeURIComponent(downloadFilename)}"`,
          }
        : {}),
    });
    return url;
  }

  async head(key: string): Promise<ObjectHead> {
    const bucket = await this.client();
    const [metadata] = await bucket.file(key).getMetadata();
    return {
      contentLength: Number(metadata.size ?? 0),
      contentType: metadata.contentType,
      etag: metadata.etag,
    };
  }

  async delete(key: string): Promise<void> {
    const bucket = await this.client();
    await bucket.file(key).delete({ ignoreNotFound: true });
  }
}
