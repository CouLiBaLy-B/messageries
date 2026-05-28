import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { User, UserRole } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email: email.toLowerCase() } });
  }

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  async createUser(input: {
    email: string;
    password: string;
    role: UserRole;
    displayName?: string;
  }): Promise<User> {
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 19_456, // ~19 MB, OWASP recommandé
      timeCost: 2,
      parallelism: 1,
    });
    const user = this.repo.create({
      email: input.email.toLowerCase(),
      passwordHash,
      role: input.role,
      displayName: input.displayName,
    });
    return this.repo.save(user);
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    try {
      return await argon2.verify(user.passwordHash, password);
    } catch {
      return false;
    }
  }
}
