import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConversationAccessGuard } from '../conversations/guards/conversation-access.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UuidPipe } from '../../common/pipes/uuid.pipe';
import { SearchService } from './search.service';

class SearchQueryDto {
  @IsString() @MinLength(2) @MaxLength(200) q!: string;
  @IsOptional() @IsUUID() conversationId?: string;
}

@ApiTags('search')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Post('conversations/:conversationId/search/enable')
  @UseGuards(ConversationAccessGuard)
  enable(@Req() req: any, @CurrentUser() user: AuthUser) {
    return this.search.enableIndexing(req.conversation.id, user.sub, user.role);
  }

  @Delete('conversations/:conversationId/search')
  @UseGuards(ConversationAccessGuard)
  disable(@Req() req: any, @CurrentUser() user: AuthUser) {
    return this.search.disableIndexing(req.conversation.id, user.sub, user.role);
  }

  @Get('search')
  @Throttle({ medium: { ttl: 60_000, limit: 30 } })
  async search(@Query() q: SearchQueryDto, @CurrentUser() user: AuthUser) {
    return this.search.search({
      userId: user.sub,
      query: q.q,
      conversationId: q.conversationId,
    });
  }
}
