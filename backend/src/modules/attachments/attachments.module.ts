import { Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Attachment } from './entities/attachment.entity';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';
import { OBJECT_STORAGE } from './providers/object-storage.interface';
import { S3StorageService } from './providers/s3-storage.service';
import { GcsStorageService } from './providers/gcs-storage.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { AuditModule } from '../audit/audit.module';

/**
 * Sélection du provider de stockage objet selon STORAGE_DRIVER :
 *  - "s3" (default) → AWS S3 / MinIO
 *  - "gcs"          → Google Cloud Storage
 *
 * Aucune régression : si STORAGE_DRIVER absent ou "s3", comportement identique
 * à toutes les phases précédentes.
 */
const storageProvider: Provider = {
  provide: OBJECT_STORAGE,
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => {
    const driver = cfg.get<string>('STORAGE_DRIVER', 's3');
    switch (driver) {
      case 'gcs':
        return new GcsStorageService(cfg);
      case 's3':
      default:
        return new S3StorageService(cfg);
    }
  },
};

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Attachment]),
    ConversationsModule,
    AuditModule,
  ],
  providers: [storageProvider, AttachmentsService],
  controllers: [AttachmentsController],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
