import {
  Body, Controller, Get, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsIn, IsOptional, IsString, MaxLength,
} from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ConversationAccessGuard } from '../../conversations/guards/conversation-access.guard';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { UuidPipe } from '../../../common/pipes/uuid.pipe';
import { E2eeService } from '../e2ee.service';

class SendMlsDto {
  @IsIn(['commit', 'application', 'proposal', 'group_info']) kind!:
    | 'commit' | 'application' | 'proposal' | 'group_info';
  @IsString() epoch!: string;
  @IsString() ciphertext!: string; // base64
  @IsString() @MaxLength(64) senderDeviceId!: string;
  @IsOptional() @IsString() targetUserId?: string;
}

@ApiTags('e2ee/messages')
@ApiBearerAuth()
@Controller('conversations/:conversationId/e2ee/messages')
@UseGuards(JwtAuthGuard, ConversationAccessGuard)
export class MlsMessagesController {
  constructor(private readonly e2ee: E2eeService) {}

  @Post()
  async send(
    @Param('conversationId', UuidPipe) conversationId: string,
    @Body() dto: SendMlsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.e2ee.sendMlsMessage({
      conversationId,
      senderId: user.sub,
      senderRole: user.role,
      senderDeviceId: dto.senderDeviceId,
      kind: dto.kind,
      epoch: dto.epoch,
      ciphertext: Buffer.from(dto.ciphertext, 'base64'),
      targetUserId: dto.targetUserId,
    });
  }

  @Get()
  async list(
    @Param('conversationId', UuidPipe) conversationId: string,
    @Query('afterSequence') afterSequence: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const rows = await this.e2ee.listMlsMessages({
      conversationId,
      userId: user.sub,
      userRole: user.role,
      afterSequence,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return rows.map((m) => ({
      id: m.id,
      kind: m.kind,
      epoch: m.epoch,
      sequence: m.sequence,
      senderDeviceId: m.senderDeviceId,
      targetUserId: m.targetUserId,
      ciphertext: m.ciphertext.toString('base64'),
      createdAt: m.createdAt,
    }));
  }
}
