import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('email_notifications')
@Index(['userId', 'kind', 'sentAt'])
export class EmailNotification {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId?: string | null;
  @Column({ type: 'varchar', length: 48 }) kind!: string;

  @CreateDateColumn({ name: 'sent_at', type: 'timestamptz' })
  sentAt!: Date;

  @Column({ name: 'dedup_key', type: 'varchar', length: 128, unique: true })
  dedupKey!: string;
}
