import { Injectable } from '@nestjs/common';

/**
 * Helpers pour créer des spans custom (business logic) sans imposer
 * la dépendance dure à @opentelemetry/api.
 */
@Injectable()
export class TracingService {
  private trace: any;

  constructor() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const api = require('@opentelemetry/api');
      this.trace = api.trace;
    } catch {
      this.trace = null;
    }
  }

  /** Wrap une fonction async dans un span métier. No-op si OTel absent. */
  async span<T>(
    name: string,
    fn: () => Promise<T>,
    attrs?: Record<string, string | number | boolean>,
  ): Promise<T> {
    if (!this.trace) return fn();
    const tracer = this.trace.getTracer('messaging-app');
    return tracer.startActiveSpan(name, async (span: any) => {
      if (attrs) {
        for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
      }
      try {
        const out = await fn();
        span.setStatus({ code: 1 }); // OK
        return out;
      } catch (e: any) {
        span.recordException(e);
        span.setStatus({ code: 2, message: e.message }); // ERROR
        throw e;
      } finally {
        span.end();
      }
    });
  }

  /** Récupère le traceId courant — utile pour corrélation logs. */
  currentTraceId(): string | null {
    if (!this.trace) return null;
    const span = this.trace.getActiveSpan();
    const ctx = span?.spanContext?.();
    return ctx?.traceId ?? null;
  }
}
