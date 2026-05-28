/**
 * Seed dev : crée 3 users + 1 order + 1 conversation pour tester rapidement.
 * Usage : `ts-node src/database/seed.ts`
 */
import 'dotenv/config';
import dataSource from './data-source';
import * as argon2 from 'argon2';
import { User } from '../modules/users/entities/user.entity';
import { Order } from '../modules/orders/entities/order.entity';
import { Conversation } from '../modules/conversations/entities/conversation.entity';
import { ConversationParticipant } from '../modules/conversations/entities/conversation-participant.entity';

async function run() {
  await dataSource.initialize();
  const passwordHash = await argon2.hash('Password1234!', { type: argon2.argon2id });

  const userRepo = dataSource.getRepository(User);
  const customer = await userRepo.save(userRepo.create({
    email: 'customer@test.com', passwordHash, role: 'customer', displayName: 'Alice (client)',
  }));
  const seller = await userRepo.save(userRepo.create({
    email: 'seller@test.com', passwordHash, role: 'seller', displayName: 'Bob (vendeur)',
  }));
  const admin = await userRepo.save(userRepo.create({
    email: 'admin@test.com', passwordHash, role: 'admin', displayName: 'Admin',
  }));

  const orderRepo = dataSource.getRepository(Order);
  const order = await orderRepo.save(orderRepo.create({
    externalRef: 'ORD-DEMO-001',
    customerId: customer.id,
    sellerId: seller.id,
    totalCents: 12990,
    currency: 'EUR',
  }));

  const convRepo = dataSource.getRepository(Conversation);
  const conv = await convRepo.save(convRepo.create({
    orderId: order.id,
    status: 'open',
    subject: `Commande ${order.externalRef}`,
  }));

  const partRepo = dataSource.getRepository(ConversationParticipant);
  await partRepo.save([
    partRepo.create({ conversationId: conv.id, userId: customer.id, role: 'customer' }),
    partRepo.create({ conversationId: conv.id, userId: seller.id, role: 'seller' }),
  ]);

  console.log('✅ Seed OK');
  console.log('---');
  console.log('Login : customer@test.com / Password1234!');
  console.log('Login : seller@test.com   / Password1234!');
  console.log('Login : admin@test.com    / Password1234!');
  console.log('orderId (à coller dans la démo) :', order.id);
  console.log('conversationId                  :', conv.id);

  await dataSource.destroy();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
