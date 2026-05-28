import {
  Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('mls_groups')
export class MlsGroup {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Index({ unique: true })
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ name: 'group_id_mls', type: 'bytea' })
  groupIdMls!: Buffer;

  @Column({ name: 'cipher_suite', type: 'varchar', length: 64 })
  cipherSuite!: string;

  @Column({ type: 'bigint', default: 0 })
  epoch!: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
