import {
  Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn,
} from 'typeorm';

export type MlsKind = 'welcome' | 'commit' | 'application' | 'proposal' | 'group_info';

@Entity('mls_messages')
@Index('IDX_mls_msg_seq', ['groupId', 'sequence'], { unique: true })
@Index(['targetUserId', 'createdAt'])
export class MlsMessage {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column({ name: 'group_id', type: 'uuid' }) groupId!: string;
  @Column({ name: 'sender_user_id', type: 'uuid', nullable: true })
  senderUserId?: string | null;
  @Column({ name: 'sender_device_id', type: 'varchar', length: 64, nullable: true })
  senderDeviceId?: string | null;

  @Column({ type: 'varchar', length: 24 })
  kind!: MlsKind;

  @Column({ type: 'bigint' })
  epoch!: string;

  @Column({ type: 'bigint' })
  sequence!: string;

  /** Si Welcome → ciblé sur 1 user (pour pickup). Sinon NULL (broadcast group). */
  @Column({ name: 'target_user_id', type: 'uuid', nullable: true })
  targetUserId?: string | null;

  @Column({ type: 'bytea' }) ciphertext!: Buffer;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
