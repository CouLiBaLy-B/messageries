import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UuidPipe } from '../../common/pipes/uuid.pipe';
import { PrivacyService } from './privacy.service';

@ApiTags('privacy')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /** Export RGPD de ses propres données */
  @Get('me/data/export')
  @Throttle({ medium: { ttl: 60_000, limit: 2 } })
  exportMine(@CurrentUser() user: AuthUser) {
    return this.privacy.exportUserData(user.sub);
  }

  /** Suppression / anonymisation de son propre compte */
  @Delete('me/data')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ medium: { ttl: 60_000, limit: 1 } })
  deleteMine(@CurrentUser() user: AuthUser) {
    return this.privacy.anonymizeUser(user.sub, user.sub);
  }

  /** Anonymisation initiée par un admin (sur demande RGPD) */
  @Delete('admin/users/:userId/data')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteByAdmin(
    @Param('userId', UuidPipe) userId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.privacy.anonymizeUser(userId, user.sub);
  }
}
