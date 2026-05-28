import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { IsEmail, IsString, MaxLength, MinLength, IsIn, IsOptional } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

class LoginDto {
  @IsEmail() @MaxLength(255) email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
}

class RegisterDto {
  @IsEmail() @MaxLength(255) email!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
  @IsIn(['customer', 'seller']) role!: 'customer' | 'seller';
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly cfg: ConfigService,
  ) {}

  @Post('register')
  @Throttle({ medium: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) return { ok: true };
    await this.users.createUser(dto);
    return { ok: true };
  }

  @Post('login')
  @Throttle({ medium: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.auth.login(dto.email, dto.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setAuthCookies(res, out.accessToken, out.refreshToken);
    return { user: out.user, accessToken: out.accessToken };
  }

  @Post('refresh')
  @Throttle({ medium: { ttl: 60_000, limit: 60 } })
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { refreshToken?: string },
  ) {
    const tokenFromCookie = req.cookies?.refresh_token as string | undefined;
    const refresh = tokenFromCookie ?? body?.refreshToken;
    if (!refresh) {
      return res.status(401).json({ message: 'No refresh token' });
    }
    const out = await this.auth.refresh(refresh, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setAuthCookies(res, out.accessToken, out.refreshToken);
    return { accessToken: out.accessToken };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthUser,
  ) {
    const refresh = req.cookies?.refresh_token as string | undefined;
    await this.auth.logout(refresh, user.sub);
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
  }

  private setAuthCookies(res: Response, access: string, refresh: string) {
    const prod = this.cfg.get<string>('NODE_ENV') === 'production';
    const common = {
      httpOnly: true,
      secure: prod,
      sameSite: 'lax' as const,
      path: '/',
    };
    res.cookie('access_token', access, {
      ...common,
      maxAge: this.cfg.get<number>('JWT_ACCESS_TTL', 900) * 1000,
    });
    res.cookie('refresh_token', refresh, {
      ...common,
      maxAge: this.cfg.get<number>('JWT_REFRESH_TTL', 2592000) * 1000,
    });
  }
}
