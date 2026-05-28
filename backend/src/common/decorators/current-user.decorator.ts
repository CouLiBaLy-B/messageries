import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  sub: string;       // user id
  role: 'customer' | 'seller' | 'support' | 'admin';
  email: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | any => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser;
    return data ? user?.[data] : user;
  },
);
