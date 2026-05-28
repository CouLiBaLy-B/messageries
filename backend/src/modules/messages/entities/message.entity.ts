import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type MessageStatus = 'sent' | 'deleted' | 'hidden' | 'flagged';

@Entity('messages')
@Index('IDX_messages_conv_seq', ['conversationId', 'sequence'], { unique: true })
@Index('IDX_messages_idem', ['conversationId', 'senderId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotency_key" IS NOT NULL',
})
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Index()
  @Column({ name: 'sender_id', type: 'uuid' })
  senderId!: string;

  @Column({ type: 'bigint' })
  sequence!: string;

  /** Texte en clair — uniquement si chiffrement applicatif désactivé. */
  @Column({ type: 'text', nullable: true })
  body?: string | null;

  /** Chiffré (AES-256-GCM). Si présent, `body` est NULL. */
  @Column({ name: 'body_ciphertext', type: 'bytea', nullable: true })
  bodyCiphertext?: Buffer | null;

  @Column({ name: 'body_dek_id', type: 'varchar', length: 128, nullable: true })
  bodyDekId?: string | null;

  @Column({ name: 'body_alg', type: 'varchar', length: 32, nullable: true })
  bodyAlg?: string | null;

  @Column({ name: 'body_iv', type: 'bytea', nullable: true })
  bodyIv?: Buffer | null;

  @Column({ name: 'body_tag', type: 'bytea', nullable: true })
  bodyTag?: Buffer | null;

  @Column({ name: 'body_format', type: 'varchar', length: 16, default: 'plain_text' })
  bodyFormat!: 'plain_text' | 'markdown';

  @Column({ type: 'varchar', length: 16, default: 'sent' })
  status!: MessageStatus;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true })
  idempotencyKey?: string | null;

  // --- Modération ---
  @Column({ name: 'moderation_flags', type: 'jsonb', nullable: true })
  moderationFlags?: string[] | null;

  @Column({ name: 'moderation_score', type: 'real', default: 0 })
  moderationScore!: number;

  @Column({ name: 'moderated_by', type: 'uuid', nullable: true })
  moderatedBy?: string | null;

  @Column({ name: 'moderated_at', type: 'timestamptz', nullable: true })
  moderatedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt?: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
