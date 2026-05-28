import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import * as argon2 from 'argon2';
import { User, UserRole } from '../../src/modules/users/entities/user.entity';
import { Order } from '../../src/modules/orders/entities/order.entity';

export async function createUser(
  ds: DataSource,
  role: UserRole,
  email = `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`,
): Promise<User> {
  const hash = await argon2.hash('Password1234!', { type: argon2.argon2id });
  return ds.getRepository(User).save(
    ds.getRepository(User).create({
      email,
      passwordHash: hash,
      role,
      displayName: `${role}_user`,
    }),
  );
}

export async function loginAs(
  app: INestApplication,
  email: string,
  password = 'Password1234!',
): Promise<{ accessToken: string; cookies: string[] }> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return {
    accessToken: res.body.accessToken as string,
    cookies: (res.headers['set-cookie'] as unknown as string[]) ?? [],
  };
}

export async function createOrder(
  ds: DataSource,
  customerId: string,
  sellerId: string,
  externalRef = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
): Promise<Order> {
  return ds.getRepository(Order).save(
    ds.getRepository(Order).create({
      externalRef,
      customerId,
      sellerId,
      status: 'open',
      totalCents: 9990,
      currency: 'EUR',
    }),
  );
}
