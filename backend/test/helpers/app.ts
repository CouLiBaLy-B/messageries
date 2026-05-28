import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';

export async function buildApp(): Promise<{ app: INestApplication; ds: DataSource }> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  const ds = app.get(DataSource);
  // applique les migrations sur la DB testcontainer
  await ds.runMigrations({ transaction: 'all' });

  return { app, ds };
}

export async function resetDb(ds: DataSource) {
  // TRUNCATE rapide entre tests (ordre RESTART IDENTITY CASCADE)
  await ds.query(`
    TRUNCATE TABLE
      audit_log, message_events_outbox, email_notifications,
      message_reports, message_receipts, attachments, messages,
      conversation_participants, conversations, orders,
      refresh_tokens, users
    RESTART IDENTITY CASCADE
  `);
}
