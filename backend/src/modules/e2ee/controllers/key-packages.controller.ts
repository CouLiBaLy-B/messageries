import {
  Body, Controller, Get, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min, MinLength,
} from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { UuidPipe } from '../../../common/pipes/uuid.pipe';
import { E2eeService } from '../e2ee.service';

class PublishKpDto {
  @IsString() @MaxLength(64) deviceId!: string;
  @IsString() @MaxLength(64) cipherSuite!: string;
  /** base64 strings (chaque KeyPackage opaque) */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  keyPackages!: string[];
  @IsOptional() @IsInt() @Min(1) ttlDays?: number;
}

@ApiTags('e2ee/key-packages')
@ApiBearerAuth()
@Controller('e2ee/key-packages')
@UseGuards(JwtAuthGuard)
export class KeyPackagesController {
  constructor(private readonly e2ee: E2eeService) {}

  /** Le client publie un pool de KeyPackages pour son device. */
  @Post()
  @Throttle({ medium: { ttl: 60_000, limit: 10 } })
  async publish(@Body() dto: PublishKpDto, @CurrentUser() user: AuthUser) {
    return this.e2ee.publishKeyPackages({
      userId: user.sub,
      deviceId: dto.deviceId,
      cipherSuite: dto.cipherSuite,
      keyPackages: dto.keyPackages.map((b) => Buffer.from(b, 'base64')),
      ttlDays: dto.ttlDays,
    });
  }

  /** Stock disponible pour un user (pour qu'il sache qu'il doit en republier). */
  @Get('count')
  count(@CurrentUser() user: AuthUser, @Query('cipherSuite') cs: string) {
    return this.e2ee.countAvailable(user.sub, cs);
  }

  /** Réclame UN KeyPackage du user target (consommation). */
  @Post('claim/:targetUserId')
  async claim(
    @Param('targetUserId', UuidPipe) targetUserId: string,
    @Query('cipherSuite') cs: string,
    @CurrentUser() user: AuthUser,
  ) {
    const res = await this.e2ee.claimKeyPackage({
      targetUserId,
      requesterId: user.sub,
      cipherSuite: cs,
    });
    return {
      keyPackageId: res.keyPackageId,
      deviceId: res.deviceId,
      keyPackage: res.keyPackage.toString('base64'),
    };
  }
}
