// Force la random KMS locale dans les tests
import { randomBytes } from 'crypto';

if (!process.env.KMS_LOCAL_KEYS) {
  process.env.KMS_LOCAL_KEYS = `test-key:${randomBytes(32).toString('base64')}`;
  process.env.KMS_LOCAL_ACTIVE = 'test-key';
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
}
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? 'http://localhost';
process.env.NODE_ENV = 'test';
process.env.ENCRYPT_MESSAGE_BODY = process.env.ENCRYPT_MESSAGE_BODY ?? 'true';
process.env.OUTBOX_WORKER_ENABLED = 'false'; // évite la concurrence dans les tests
