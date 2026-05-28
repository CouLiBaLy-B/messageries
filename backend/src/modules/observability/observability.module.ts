import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MetricsService } from './metrics.service';
import { TracingService } from './tracing/tracing.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [MetricsService, TracingService],
  exports: [MetricsService, TracingService],
})
export class ObservabilityModule {}
