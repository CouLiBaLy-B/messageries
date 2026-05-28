import { Column, Entity, PrimaryColumn, Index } from 'typeorm';

@Entity('message_receipts')
@Index(['userId', 'messageId'])
export class MessageReceipt {
  @PrimaryColumn({ name: 'message_id', type: 'uuid' })
  messageId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt?: Date | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt?: Date | null;
}
