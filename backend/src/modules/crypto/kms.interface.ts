export const KMS_PROVIDER = Symbol('KMS_PROVIDER');

export interface KmsProvider {
  /** Renvoie l'identifiant logique de la KEK active (pour stockage). */
  activeKeyId(): string;

  /** Génère une DEK aléatoire (32 bytes) et son wrap par la KEK. */
  generateDataKey(): Promise<{ keyId: string; plaintext: Buffer; ciphertext: Buffer }>;

  /** Décrypte une DEK wrappée. */
  decryptDataKey(keyId: string, ciphertext: Buffer): Promise<Buffer>;
}
