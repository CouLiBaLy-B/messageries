import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ScanStatus = 'pending' | 'clean' | 'infected' | 'failed';

@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId?: string | null;

  @Index()
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ name: 'uploader_id', type: 'uuid' })
  uploaderId!: string;

  @Column({ name: 'object_key', type: 'text' })
  objectKey!: string; // chemin S3

  @Column({ name: 'original_filename', type: 'varchar', length: 255 })
  originalFilename!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 128 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  sha256?: string | null;

  @Column({ name: 'scan_status', type: 'varchar', length: 16, default: 'pending' })
  scanStatus!: ScanStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
