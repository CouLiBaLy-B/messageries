import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrdersService } from './orders.service';

class CreateOrderDto {
  @IsString() @MaxLength(64) externalRef!: string;
  @IsUUID() customerId!: string;
  @IsUUID() sellerId!: string;
  @IsOptional() @IsEnum(['open','shipped','delivered','cancelled','refunded','closed']) status?: any;
  @IsOptional() @IsInt() @Min(0) totalCents?: number;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
}

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** Endpoint de sync (admin uniquement — en prod : webhook HMAC). */
  @Post()
  @Roles('admin')
  upsert(@Body() dto: CreateOrderDto) {
    return this.orders.upsertFromExternal(dto);
  }
}
