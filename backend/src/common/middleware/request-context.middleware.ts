import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { logger, requestId } from '../logging/pino-logger';

/**
 * Injecte un X-Request-Id, log start/end avec durée + status + traceId.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const reqId = (req.headers['x-request-id'] as string) || requestId();
    (req as any).reqId = reqId;
    res.setHeader('x-request-id', reqId);

    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number((process.hrtime.bigint() - start) / 1_000_000n);
      logger.info(
        {
          reqId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: ms,
          ip: req.ip,
          ua: req.headers['user-agent'],
        },
        'http.request',
      );
    });
    next();
  }
}
