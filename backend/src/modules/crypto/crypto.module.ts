import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EnvelopeCryptoService } from './envelope-crypto.service';
import { KMS_PROVIDER } from './kms.interface';
import { LocalKmsProvider } from './providers/local-kms.provider';
import { AwsKmsProvider } from './providers/aws-kms.provider';
import { GcpKmsProvider } from './providers/gcp-kms.provider';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: KMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const driver = cfg.get<string>('KMS_DRIVER', 'local');
        switch (driver) {
          case 'aws':
            return new AwsKmsProvider(cfg);
          case 'gcp':
            return new GcpKmsProvider(cfg);
          case 'local':
          default:
            return new LocalKmsProvider(cfg);
        }
      },
    },
    EnvelopeCryptoService,
  ],
  exports: [EnvelopeCryptoService],
})
export class CryptoModule {}
