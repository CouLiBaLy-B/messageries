/**
 * Interface unifiée pour stockage objet (S3, GCS, MinIO, etc.).
 * Permet de switcher AWS ↔ GCP sans toucher au reste du code.
 */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface ObjectHead {
  contentLength?: number;
  contentType?: string;
  etag?: string;
}

export interface ObjectStorageService {
  /** Renvoie une URL signée pour upload (PUT). */
  presignPut(
    key: string,
    mimeType: string,
    maxBytes: number,
    ttlSec?: number,
  ): Promise<string>;

  /** Renvoie une URL signée pour download (GET). */
  presignGet(
    key: string,
    ttlSec?: number,
    downloadFilename?: string,
  ): Promise<string>;

  /** Retourne des métadonnées sur l'objet (ou throw si absent). */
  head(key: string): Promise<ObjectHead>;

  delete(key: string): Promise<void>;
}
