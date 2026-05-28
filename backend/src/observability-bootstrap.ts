/**
 * ⚠️ Doit être importé AVANT tout autre code applicatif (require/instrumentation).
 * Bootstrap OpenTelemetry — traces vers OTLP (ADOT collector → X-Ray).
 *
 * Activé seulement si TRACING_ENABLED=true.
 * Lazy require (les paquets @opentelemetry/* peuvent ne pas être installés en dev).
 */

if (process.env.TRACING_ENABLED === 'true') {
  try {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
    const { Resource } = require('@opentelemetry/resources');
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
    const { AwsXRayPropagator } = require('@opentelemetry/propagator-aws-xray');
    const { AWSXRayIdGenerator } = require('@opentelemetry/id-generator-aws-xray');
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
    const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
    const { NestInstrumentation } = require('@opentelemetry/instrumentation-nestjs-core');
    const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
    const { IORedisInstrumentation } = require('@opentelemetry/instrumentation-ioredis');
    const { SocketIoInstrumentation } = require('@opentelemetry/instrumentation-socket.io');

    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'messaging-api';
    const env = process.env.NODE_ENV ?? 'development';

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: env,
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION ?? '0.4.0',
      }),
      traceExporter: new OTLPTraceExporter({
        // ADOT collector en sidecar : http://localhost:4318/v1/traces
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
      }),
      idGenerator: new AWSXRayIdGenerator(),
      textMapPropagator: new AwsXRayPropagator(),
      instrumentations: [
        new HttpInstrumentation({
          // Health check trop bruyant
          ignoreIncomingRequestHook: (req) =>
            (req.url ?? '').includes('/health'),
        }),
        new ExpressInstrumentation(),
        new NestInstrumentation(),
        new PgInstrumentation({ enhancedDatabaseReporting: true }),
        new IORedisInstrumentation(),
        new SocketIoInstrumentation(),
      ],
    });

    sdk.start();
    process.on('SIGTERM', () => {
      sdk.shutdown().finally(() => process.exit(0));
    });
    // eslint-disable-next-line no-console
    console.log(`[otel] tracing enabled service=${serviceName} env=${env}`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[otel] tracing disabled — install @opentelemetry/* packages: ${(e as Error).message}`,
    );
  }
}
