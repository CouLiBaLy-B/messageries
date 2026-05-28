import {
  Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn,
} from 'typeorm';

export type ReportStatus = 'open' | 'reviewed' | 'dismissed' | 'actioned';

@Entity('message_reports')
@Index(['status', 'createdAt'])
export class MessageReport {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Index() @Column({ name: 'message_id', type: 'uuid' }) messageId!: string;
  @Column({ name: 'reporter_id', type: 'uuid' }) reporterId!: string;
  @Column({ type: 'varchar', length: 64 }) reason!: string;
  @Column({ type: 'text', nullable: true }) details?: string | null;
  @Column({ type: 'varchar', length: 16, default: 'open' }) status!: ReportStatus;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy?: string | null;
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
