import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PresenceService } from './presence.service';

@Module({
  imports: [ConfigModule],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
