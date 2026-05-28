import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let payload: Record<string, unknown> = {
      statusCode: status,
      error: 'Internal Server Error',
      message: 'Une erreur est survenue',
      path: req.url,
      timestamp: new Date().toISOString(),
    };

    if (exception instanceof HttpException) {
      const r = exception.getResponse();
      payload = {
        ...payload,
        ...(typeof r === 'string' ? { message: r } : (r as object)),
      };
    } else {
      // ⚠️ Ne jamais leak le message interne en prod
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.url}`,
        (exception as Error)?.stack,
      );
    }

    res.status(status).json(payload);
  }
}
