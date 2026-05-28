import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryColumn,
  JoinColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';

export type ParticipantRole = 'customer' | 'seller' | 'support' | 'admin';

@Entity('conversation_participants')
@Index(['userId', 'conversationId'])
export class ConversationParticipant {
  @PrimaryColumn({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: ParticipantRole;

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt!: Date;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt?: Date | null;

  @Column({ type: 'boolean', default: false })
  muted!: boolean;

  @Column({ name: 'last_read_sequence', type: 'bigint', default: 0 })
  lastReadSequence!: string;

  @ManyToOne(() => Conversation, (c) => c.participants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: Conversation;
}
