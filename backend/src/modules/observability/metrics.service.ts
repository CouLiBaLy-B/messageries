import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Émission de métriques applicatives vers CloudWatch.
 * - Buffer interne, flush toutes les 30s (PutMetricData max 20 metrics/call).
 * - No-op si METRICS_ENABLED=false (dev).
 * - SDK lazy : on n'impose pas @aws-sdk/client-cloudwatch en dev.
 */

interface MetricDatum {
  MetricName: string;
  Value: number;
  Unit?: string;
  Timestamp: Date;
  Dimensions?: { Name: string; Value: string }[];
}

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly enabled: boolean;
  private readonly namespace: string;
  private readonly region: string;
  private buffer: MetricDatum[] = [];
  private client: any;
  private flushTimer?: NodeJS.Timeout;

  constructor(cfg: ConfigService) {
    this.enabled = cfg.get<boolean>('METRICS_ENABLED', false);
    this.namespace = cfg.get<string>('METRICS_NAMESPACE', 'Messaging');
    this.region = cfg.get<string>('AWS_REGION', 'eu-west-3');
    if (this.enabled) {
      this.bootstrap();
    }
  }

  private async bootstrap() {
    try {
      // Lazy import — évite la dépendance dure en dev
      const { CloudWatchClient, PutMetricDataCommand } = await import('@aws-sdk/client-cloudwatch');
      this.client = { CloudWatchClient, PutMetricDataCommand, instance: new CloudWatchClient({ region: this.region }) };
      this.flushTimer = setInterval(() => this.flush().catch(() => {}), 30_000);
      this.logger.log(`Metrics enabled (ns=${this.namespace}, region=${this.region})`);
    } catch (e) {
      this.logger.warn(`Metrics disabled (sdk not available): ${(e as Error).message}`);
      this.client = null;
    }
  }

  onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flush().catch(() => {});
  }

  /** Incrémente un compteur (Count). */
  count(name: string, value = 1, dimensions?: Record<string, string>) {
    this.push(name, value, 'Count', dimensions);
  }

  /** Publie une valeur instantanée (gauge). */
  gauge(name: string, value: number, unit = 'None', dimensions?: Record<string, string>) {
    this.push(name, value, unit, dimensions);
  }

  /** Publie une durée en ms. */
  timing(name: string, ms: number, dimensions?: Record<string, string>) {
    this.push(name, ms, 'Milliseconds', dimensions);
  }

  private push(name: string, value: number, unit: string, dimensions?: Record<string, string>) {
    if (!this.enabled) return;
    this.buffer.push({
      MetricName: name,
      Value: value,
      Unit: unit,
      Timestamp: new Date(),
      Dimensions: dimensions
        ? Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value }))
        : undefined,
    });
    if (this.buffer.length >= 20) this.flush().catch(() => {});
  }

  async flush() {
    if (!this.enabled || !this.client || this.buffer.length === 0) return;
    const datums = this.buffer.splice(0, this.buffer.length);
    // PutMetricData : max 20 par call
    while (datums.length) {
      const chunk = datums.splice(0, 20);
      try {
        await this.client.instance.send(
          new this.client.PutMetricDataCommand({
            Namespace: this.namespace,
            MetricData: chunk,
          }),
        );
      } catch (e) {
        this.logger.warn(`PutMetricData failed: ${(e as Error).message}`);
        // on jette les métriques pour ne pas grossir indéfiniment
      }
    }
  }
}
