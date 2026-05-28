import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ConversationParticipant } from './conversation-participant.entity';

export type ConversationStatus = 'open' | 'closed' | 'archived';

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * 🎯 Règle métier centrale :
   * 1 conversation = 1 commande → contrainte UNIQUE.
   */
  @Index({ unique: true })
  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ type: 'varchar', length: 32, default: 'open' })
  status!: ConversationStatus;

  @Column({ name: 'subject', type: 'varchar', length: 200, nullable: true })
  subject?: string;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt?: Date | null;

  @Column({ name: 'last_sequence', type: 'bigint', default: 0 })
  lastSequence!: string; // bigint -> string en TypeORM

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ConversationParticipant, (p) => p.conversation)
  participants?: ConversationParticipant[];
}
