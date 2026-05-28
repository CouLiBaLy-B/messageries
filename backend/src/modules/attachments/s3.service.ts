import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly kmsKeyArn?: string;

  constructor(private readonly cfg: ConfigService) {
    this.bucket = cfg.get<string>('S3_BUCKET')!;
    this.kmsKeyArn = cfg.get<string>('AWS_KMS_KEY_ARN') || undefined;
    const useIamRole = cfg.get<boolean>('S3_USE_IAM_ROLE', false);
    this.client = new S3Client({
      endpoint: cfg.get<string>('S3_ENDPOINT'),
      region: cfg.get<string>('S3_REGION'),
      forcePathStyle: cfg.get<boolean>('S3_FORCE_PATH_STYLE', true),
      credentials: useIamRole
        ? undefined // ← laisse le SDK utiliser le rôle IAM de la task ECS
        : {
            accessKeyId: cfg.get<string>('S3_ACCESS_KEY')!,
            secretAccessKey: cfg.get<string>('S3_SECRET_KEY')!,
          },
    });
  }

  presignPut(key: string, mimeType: string, maxBytes: number, ttlSec = 300) {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
      ContentLength: maxBytes,
      ...(this.kmsKeyArn
        ? {
            ServerSideEncryption: 'aws:kms',
            SSEKMSKeyId: this.kmsKeyArn,
          }
        : {}),
    });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSec });
  }

  presignGet(key: string, ttlSec = 60, downloadFilename?: string) {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: downloadFilename
        ? `attachment; filename="${encodeURIComponent(downloadFilename)}"`
        : undefined,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: ttlSec });
  }

  async head(key: string) {
    return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async delete(key: string) {
    return this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
