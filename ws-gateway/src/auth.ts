import { jwtVerify } from 'jose';

export interface JwtPayload {
  sub: string;
  role: 'customer' | 'seller' | 'support' | 'admin';
  email: string;
  exp?: number;
}

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '');

export async function verifyJwt(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
  return payload as unknown as JwtPayload;
}

export function extractToken(handshakeAuth: any, cookieHeader?: string): string | undefined {
  const fromAuth = handshakeAuth?.token;
  if (fromAuth && typeof fromAuth === 'string') return fromAuth;
  if (cookieHeader) {
    const m = /access_token=([^;]+)/.exec(cookieHeader);
    if (m) return m[1];
  }
  return undefined;
}
