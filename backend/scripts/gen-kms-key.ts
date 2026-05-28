/**
 * Génère une nouvelle clé KMS locale (32 bytes, base64).
 * Usage : ts-node scripts/gen-kms-key.ts [keyId]
 * Imprime la ligne à coller dans KMS_LOCAL_KEYS.
 */
import { randomBytes } from 'crypto';
const id = process.argv[2] ?? `key-${Date.now()}`;
const key = randomBytes(32).toString('base64');
console.log(`${id}:${key}`);
console.log(`\n→ Ajoute cette ligne dans KMS_LOCAL_KEYS (séparé par virgules) et change KMS_LOCAL_ACTIVE=${id}`);
