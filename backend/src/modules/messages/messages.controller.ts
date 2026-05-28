import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConversationAccessGuard } from '../conversations/guards/conversation-access.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UuidPipe } from '../../common/pipes/uuid.pipe';
import { MessagesService } from './messages.service';
import { ListMessagesQueryDto, MarkReadDto, SendMessageDto } from './dto/send-message.dto';

@ApiTags('messages')
@ApiBearerAuth()
@Controller('conversations/:conversationId/messages')
@UseGuards(JwtAuthGuard, ConversationAccessGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  @Throttle({ medium: { ttl: 60_000, limit: 30 } })
  async send(
    @Param('conversationId', UuidPipe) conversationId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') headerKey?: string,
  ) {
    return this.messages.send({
      conversationId,
      senderId: user.sub,
      body: dto.body,
      idempotencyKey: dto.idempotencyKey ?? headerKey,
    });
  }

  @Get()
  async list(
    @Param('conversationId', UuidPipe) conversationId: string,
    @Query() q: ListMessagesQueryDto,
  ) {
    return this.messages.list({
      conversationId,
      afterSequence: q.afterSequence,
      beforeSequence: q.beforeSequence,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    });
  }

  @Post('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @Param('conversationId', UuidPipe) conversationId: string,
    @Body() dto: MarkReadDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.messages.markRead(conversationId, user.sub, dto.uptoSequence);
  }

  @Delete(':messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('messageId', UuidPipe) messageId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.messages.softDelete(messageId, user.sub);
  }
}
