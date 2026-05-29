import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObjectHead, ObjectStorageService } from './object-storage.interface';

/**
 * Implémentation Google Cloud Storage.
 * Lazy import de @google-cloud/storage pour ne pas imposer la dep en dev/test S3.
 */
@Injectable()
export class GcsStorageService implements ObjectStorageService {
  private readonly logger = new Logger(GcsStorageService.name);
  private readonly bucketName: string;
  private storage: any;
  private bucket: any;

  constructor(private readonly cfg: ConfigService) {
    this.bucketName = cfg.get<string>('GCS_BUCKET')!;
    if (!this.bucketName) {
      throw new Error('GCS_BUCKET required when STORAGE_DRIVER=gcs');
    }
  }

  private async client() {
    if (this.bucket) return this.bucket;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Storage } = await import('@google-cloud/storage');
      // En prod (Cloud Run) : ADC via service account du runtime.
      // En local : GOOGLE_APPLICATION_CREDENTIALS doit pointer un keyfile.
      this.storage = new Storage();
      this.bucket = this.storage.bucket(this.bucketName);
      return this.bucket;
    } catch (e) {
      throw new Error(
        `@google-cloud/storage requis pour STORAGE_DRIVER=gcs : ${(e as Error).message}`,
      );
    }
  }

  async presignPut(key: string, mimeType: string, maxBytes: number, ttlSec = 300) {
    const bucket = await this.client();
    const [url] = await bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + ttlSec * 1000,
      contentType: mimeType,
      extensionHeaders: {
        // GCS recommande d'imposer le content-length au moment de l'upload
        'x-goog-content-length-range': `0,${maxBytes}`,
      },
    });
    return url;
  }

  async presignGet(key: string, ttlSec = 60, downloadFilename?: string) {
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
