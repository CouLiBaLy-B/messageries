import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Référentiel minimal des commandes.
 * Synchronisé depuis l'e-commerce (webhook / job).
 * On ne stocke QUE ce qui est nécessaire à l'autorisation messagerie.
 */
@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'external_ref', type: 'varchar', length: 64 })
  externalRef!: string; // ex: "ORD-2026-00042"

  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Index()
  @Column({ name: 'seller_id', type: 'uuid' })
  sellerId!: string;

  @Column({ type: 'varchar', length: 32, default: 'open' })
  status!: 'open' | 'shipped' | 'delivered' | 'cancelled' | 'refunded' | 'closed';

  @Column({ name: 'total_cents', type: 'integer', default: 0 })
  totalCents!: number;

  @Column({ type: 'varchar', length: 3, default: 'EUR' })
  currency!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
