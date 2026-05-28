// ⚠️ Doit être tout premier : initialise OpenTelemetry avant tout autre require.
import './observability-bootstrap';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { logger } from './common/logging/pino-logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });
  const config = app.get(ConfigService);
  const log = new Logger('Bootstrap');

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);

  const apiPrefix = config.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      hsts:
        config.get<string>('NODE_ENV') === 'production'
          ? { maxAge: 63072000, includeSubDomains: true, preload: true }
          : false,
    }),
  );

  app.use(cookieParser());

  const origins = (config.get<string>('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connectToRedis(
    config.get<string>('REDIS_HOST', 'localhost'),
    config.get<number>('REDIS_PORT', 6379),
    config.get<string>('REDIS_PASSWORD') || undefined,
    config.get<boolean>('REDIS_TLS', false),
  );
  app.useWebSocketAdapter(redisAdapter);

  if (config.get<string>('NODE_ENV') !== 'production') {
    const swagger = new DocumentBuilder()
      .setTitle('E-commerce Messaging API')
      .setDescription('Messagerie liée aux commandes')
      .setVersion('0.4.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, doc);
  }

  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3000);
  await app.listen(port, '0.0.0.0');
  log.log(`🚀 API running on http://0.0.0.0:${port}/${apiPrefix}`);
  logger.info({ port, apiPrefix }, 'bootstrap.ready');
}
bootstrap();
