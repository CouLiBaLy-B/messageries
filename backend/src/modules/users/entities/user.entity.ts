import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type UserRole = 'customer' | 'seller' | 'support' | 'admin';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'citext' })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: UserRole;

  @Column({ type: 'varchar', length: 120, nullable: true })
  displayName?: string;

  @Column({ name: 'mfa_secret', type: 'text', nullable: true })
  mfaSecret?: string | null;

  @Column({ name: 'is_suspended', type: 'boolean', default: false })
  isSuspended!: boolean;

  @Column({ name: 'anonymized_at', type: 'timestamptz', nullable: true })
  anonymizedAt?: Date | null;

  @Column({ name: 'data_export_requested_at', type: 'timestamptz', nullable: true })
  dataExportRequestedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
