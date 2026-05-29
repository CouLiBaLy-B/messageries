/**
 * Setup global Jest avant tout import : pose des placeholders d'env pour que
 * la validation Joi du ConfigModule passe au chargement de AppModule.
 *
 * Les valeurs réelles (DB_HOST, S3_*) sont injectées par `startInfra()` (Testcontainers)
 * AVANT que `buildApp()` ne soit appelé dans `beforeAll`. Comme TypeORM lit
 * `process.env.*` au moment du DataSource constructor (pas du module load),
 * les valeurs des containers prennent le dessus.
 */
import { randomBytes } from 'crypto';

const def = (k: string, v: string) => {
  if (!process.env[k]) process.env[k] = v;
};

// --- Auth / crypto ---
if (!process.env.KMS_LOCAL_KEYS) {
  process.env.KMS_LOCAL_KEYS = `test-key:${randomBytes(32).toString('base64')}`;
  process.env.KMS_LOCAL_ACTIVE = 'test-key';
}
def('JWT_SECRET', randomBytes(48).toString('hex'));
def('ALLOWED_ORIGINS', 'http://localhost');

// --- Placeholders requis par envValidationSchema ---
// Postgres
def('DB_HOST', 'placeholder');
def('DB_PORT', '5432');
def('DB_USERNAME', 'placeholder');
def('DB_PASSWORD', 'placeholder');
def('DB_NAME', 'placeholder');
// Redis
def('REDIS_HOST', 'placeholder');
def('REDIS_PORT', '6379');
// S3 (override par startInfra avec MinIO local)
def('S3_ENDPOINT', 'http://localhost:9000');
def('S3_REGION', 'us-east-1');
def('S3_BUCKET', 'placeholder');
def('S3_ACCESS_KEY', 'placeholder');
def('S3_SECRET_KEY', 'placeholder');

// --- Comportements test-friendly ---
process.env.NODE_ENV = 'test';
process.env.ENCRYPT_MESSAGE_BODY = process.env.ENCRYPT_MESSAGE_BODY ?? 'true';
process.env.OUTBOX_WORKER_ENABLED = 'false';
def('STORAGE_DRIVER', 's3');
