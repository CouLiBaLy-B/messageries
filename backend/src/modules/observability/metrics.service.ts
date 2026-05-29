import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Métriques applicatives unifiées : un seul appelant (`metrics.count/gauge/timing`),
 * 2 backends derrière :
 *   - METRICS_DRIVER=cloudwatch (default) → AWS CloudWatch PutMetricData
 *   - METRICS_DRIVER=gcp                  → Cloud Monitoring TimeSeries.create
 *
 * Buffer + flush 30s, SDK lazy-loaded → zéro dep imposée en dev.
 */

interface MetricDatum {
  name: string;
  value: number;
  unit?: string;
  timestamp: Date;
  dimensions?: Record<string, string>;
}

interface MetricsBackend {
  flush(buffer: MetricDatum[]): Promise<void>;
}

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsService.name);
  private readonly enabled: boolean;
  private readonly namespace: string;
  private readonly driver: string;
  private buffer: MetricDatum[] = [];
  private backend?: MetricsBackend;
  private flushTimer?: NodeJS.Timeout;

  constructor(private readonly cfg: ConfigService) {
    this.enabled = cfg.get<boolean>('METRICS_ENABLED', false);
    this.namespace = cfg.get<string>('METRICS_NAMESPACE', 'Messaging');
    this.driver = cfg.get<string>('METRICS_DRIVER', 'cloudwatch');
    if (this.enabled) this.bootstrap();
  }

  private async bootstrap() {
    try {
      switch (this.driver) {
        case 'gcp':
          this.backend = await this.createGcpBackend();
          break;
        case 'cloudwatch':
        default:
          this.backend = await this.createCloudWatchBackend();
      }
      this.flushTimer = setInterval(() => this.flush().catch(() => {}), 30_000);
      this.logger.log(`Metrics enabled (driver=${this.driver}, ns=${this.namespace})`);
    } catch (e) {
      this.logger.warn(`Metrics disabled (sdk not available): ${(e as Error).message}`);
      this.backend = undefined;
    }
  }

  onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flush().catch(() => {});
  }

  count(name: string, value = 1, dimensions?: Record<string, string>) {
    this.push(name, value, 'Count', dimensions);
  }
  gauge(name: string, value: number, unit = 'None', dimensions?: Record<string, string>) {
    this.push(name, value, unit, dimensions);
  }
  timing(name: string, ms: number, dimensions?: Record<string, string>) {
    this.push(name, ms, 'Milliseconds', dimensions);
  }

  private push(
    name: string,
    value: number,
    unit: string,
    dimensions?: Record<string, string>,
  ) {
    if (!this.enabled) return;
    this.buffer.push({ name, value, unit, timestamp: new Date(), dimensions });
    if (this.buffer.length >= 20) this.flush().catch(() => {});
  }

  async flush() {
    if (!this.enabled || !this.backend || this.buffer.length === 0) return;
    const data = this.buffer.splice(0, this.buffer.length);
    try {
      await this.backend.flush(data);
    } catch (e) {
      this.logger.warn(`flush failed (${this.driver}): ${(e as Error).message}`);
    }
  }

  // ----- Backends -----

  private async createCloudWatchBackend(): Promise<MetricsBackend> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CloudWatchClient, PutMetricDataCommand } = await import(
      '@aws-sdk/client-cloudwatch'
    );
    const region = this.cfg.get<string>('AWS_REGION', 'eu-west-3');
    const client = new CloudWatchClient({ region });
    const namespace = this.namespace;
    return {
      async flush(buffer) {
        while (buffer.length) {
          const chunk = buffer.splice(0, 20);
          await client.send(
            new PutMetricDataCommand({
              Namespace: namespace,
              MetricData: chunk.map((d) => ({
                MetricName: d.name,
                Value: d.value,
                Unit: d.unit as any,
                Timestamp: d.timestamp,
                Dimensions: d.dimensions
                  ? Object.entries(d.dimensions).map(([Name, Value]) => ({ Name, Value }))
                  : undefined,
              })),
            }),
          );
        }
      },
    };
  }

  private async createGcpBackend(): Promise<MetricsBackend> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const monitoring = await import('@google-cloud/monitoring');
    const client = new monitoring.MetricServiceClient();
    const projectId =
      this.cfg.get<string>('GCP_PROJECT_ID') ||
      (await client.getProjectId());
    const projectName = `projects/${projectId}`;
    // Namespace doit ressembler à "custom.googleapis.com/<...>"
    const baseType = this.namespace.startsWith('custom.googleapis.com')
      ? this.namespace
      : `custom.googleapis.com/${this.namespace.toLowerCase()}`;
    return {
      async flush(buffer) {
        // GCP : 1 TimeSeries par metric type → on agrège par name
        const byMetric: Record<string, MetricDatum[]> = {};
        for (const d of buffer) {
          const k = `${d.name}|${JSON.stringify(d.dimensions ?? {})}`;
          (byMetric[k] ||= []).push(d);
        }
        const series = Object.values(byMetric).map((datums) => {
          const first = datums[0];
          return {
            metric: {
              type: `${baseType}/${first.name}`,
              labels: first.dimensions ?? {},
            },
            resource: { type: 'global', labels: { project_id: projectId } },
            points: datums.map((d) => ({
              interval: {
                endTime: { seconds: Math.floor(d.timestamp.getTime() / 1000) },
              },
              value: { doubleValue: d.value },
            })),
          };
        });
        // 200 max par call
        while (series.length) {
          const chunk = series.splice(0, 200);
          await client.createTimeSeries({ name: projectName, timeSeries: chunk });
        }
      },
    };
  }
}
