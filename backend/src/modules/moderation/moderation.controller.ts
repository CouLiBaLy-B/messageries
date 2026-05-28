import {
  Body, Controller, Get, Param, Post, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UuidPipe } from '../../common/pipes/uuid.pipe';
import { ModerationService } from './moderation.service';

class ReportDto {
  @IsString() @MinLength(3) @MaxLength(64) reason!: string;
  @IsOptional() @IsString() @MaxLength(2000) details?: string;
}
class ResolveDto {
  @IsIn(['dismiss', 'hide_message']) action!: 'dismiss' | 'hide_message';
}

@ApiTags('moderation')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private readonly mod: ModerationService) {}

  /** Tout utilisateur authentifié peut signaler un message qu'il a pu voir. */
  @Post('messages/:messageId/report')
  report(
    @Param('messageId', UuidPipe) messageId: string,
    @Body() dto: ReportDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mod.report({
      messageId,
      reporterId: user.sub,
      reason: dto.reason,
      details: dto.details,
    });
  }

  @Get('admin/reports')
  @UseGuards(RolesGuard)
  @Roles('support', 'admin')
  list() {
    return this.mod.listOpen();
  }

  @Post('admin/reports/:reportId/resolve')
  @UseGuards(RolesGuard)
  @Roles('support', 'admin')
  resolve(
    @Param('reportId', UuidPipe) reportId: string,
    @Body() dto: ResolveDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.mod.resolve({
      reportId,
      moderatorId: user.sub,
      action: dto.action,
    });
  }
}
