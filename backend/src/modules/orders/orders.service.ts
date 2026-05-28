import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';

@Injectable()
export class OrdersService {
  constructor(@InjectRepository(Order) private readonly repo: Repository<Order>) {}

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  async getOrThrow(id: string): Promise<Order> {
    const o = await this.findById(id);
    if (!o) throw new NotFoundException('Commande introuvable');
    return o;
  }

  /** Sync depuis l'e-commerce (webhook). À sécuriser via signature HMAC. */
  upsertFromExternal(input: {
    externalRef: string;
    customerId: string;
    sellerId: string;
    status?: Order['status'];
    totalCents?: number;
    currency?: string;
  }): Promise<Order> {
    return this.repo.save(
      this.repo.create({
        externalRef: input.externalRef,
        customerId: input.customerId,
        sellerId: input.sellerId,
        status: input.status ?? 'open',
        totalCents: input.totalCents ?? 0,
        currency: input.currency ?? 'EUR',
      }),
    );
  }
}
