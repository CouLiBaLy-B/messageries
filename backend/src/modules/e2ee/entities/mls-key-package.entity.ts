import {
  Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('mls_key_packages')
@Index(['userId', 'expiresAt'], { where: 'consumed_at IS NULL' })
export class MlsKeyPackage {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'device_id', type: 'varchar', length: 64 }) deviceId!: string;
  @Column({ name: 'cipher_suite', type: 'varchar', length: 64 }) cipherSuite!: string;
  @Column({ name: 'key_package', type: 'bytea' }) keyPackage!: Buffer;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt?: Date | null;
  @Column({ name: 'consumed_by', type: 'uuid', nullable: true })
  consumedBy?: string | null;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
