import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export type Role = 'customer' | 'seller' | 'support' | 'admin';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
