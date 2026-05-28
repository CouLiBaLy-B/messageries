/**
 * Crée 50 couples (customer, seller) + 1 commande/couple + conversation.
 * Usage : ts-node src/database/seed-loadtest.ts [N]
 */
import 'dotenv/config';
import dataSource from './data-source';
import * as argon2 from 'argon2';
import { User } from '../modules/users/entities/user.entity';
import { Order } from '../modules/orders/entities/order.entity';
import { Conversation } from '../modules/conversations/entities/conversation.entity';
import { ConversationParticipant } from '../modules/conversations/entities/conversation-participant.entity';

async function run() {
  const N = Number(process.argv[2] ?? 50);
  await dataSource.initialize();
  const hash = await argon2.hash('Password1234!', { type: argon2.argon2id });

  const users = dataSource.getRepository(User);
  const orders = dataSource.getRepository(Order);
  const convs = dataSource.getRepository(Conversation);
  const parts = dataSource.getRepository(ConversationParticipant);

  for (let i = 0; i < N; i++) {
    const customer = await users.save(
      users.create({
        email: `loadtest_customer_${i}@test.com`,
        passwordHash: hash,
        role: 'customer',
        displayName: `LT customer ${i}`,
      }),
    );
    const seller = await users.save(
      users.create({
        email: `loadtest_seller_${i}@test.com`,
        passwordHash: hash,
        role: 'seller',
        displayName: `LT seller ${i}`,
      }),
    );
    const order = await orders.save(
      orders.create({
        externalRef: `LT-ORD-${i}`,
        customerId: customer.id,
        sellerId: seller.id,
        totalCents: 1990,
        currency: 'EUR',
      }),
    );
    const conv = await convs.save(
      convs.create({
        orderId: order.id,
        subject: `Commande LT-${i}`,
        status: 'open',
      }),
    );
    await parts.save([
      parts.create({ conversationId: conv.id, userId: customer.id, role: 'customer' }),
      parts.create({ conversationId: conv.id, userId: seller.id, role: 'seller' }),
    ]);
  }
  console.log(`✅ Seed loadtest OK : ${N} couples créés`);
  await dataSource.destroy();
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
