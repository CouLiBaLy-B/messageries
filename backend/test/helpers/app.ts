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
  await ds.runMigrations({ transaction: 'all' });

  return { app, ds };
}

/**
 * TRUNCATE de toutes les tables non-système entre les tests.
 *  - Découverte dynamique → robuste aux nouvelles migrations sans
 *    devoir maintenir la liste à la main (régression évitée).
 *  - Exclut les tables de gestion TypeORM (migrations).
 */
export async function resetDb(ds: DataSource) {
  const rows: { tablename: string }[] = await ds.query(`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename NOT IN ('migrations', 'typeorm_metadata')
  `);
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  await ds.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
