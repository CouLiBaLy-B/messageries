import {
  Body, Controller, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ArrayMinSize, IsArray, IsString, MaxLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ConversationAccessGuard } from '../../conversations/guards/conversation-access.guard';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { UuidPipe } from '../../../common/pipes/uuid.pipe';
import { E2eeService } from '../e2ee.service';

class WelcomeDto {
  @IsString() targetUserId!: string;
  @IsString() ciphertext!: string; // base64
  @IsString() @MaxLength(64) senderDeviceId!: string;
}

class EnableE2eeDto {
  @IsString() groupIdMls!: string; // base64
  @IsString() @MaxLength(64) cipherSuite!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => WelcomeDto)
  welcomeMessages!: WelcomeDto[];
}

@ApiTags('e2ee/groups')
@ApiBearerAuth()
@Controller('conversations/:conversationId/e2ee')
@UseGuards(JwtAuthGuard, ConversationAccessGuard)
export class MlsGroupsController {
  constructor(private readonly e2ee: E2eeService) {}

  /** Activation : client a déjà claim les KeyPackages, créé le groupe MLS, généré
   *  les Welcomes pour chaque participant — il les pousse au serveur en bulk. */
  @Post('enable')
  async enable(
    @Param('conversationId', UuidPipe) conversationId: string,
    @Body() dto: EnableE2eeDto,
    @Req() req: any,
    @CurrentUser() user: AuthUser,
  ) {
    return this.e2ee.enableE2ee({
      conversationId,
      actorId: user.sub,
      actorRole: user.role,
      groupIdMls: Buffer.from(dto.groupIdMls, 'base64'),
      cipherSuite: dto.cipherSuite,
      welcomeMessages: dto.welcomeMessages.map((w) => ({
        targetUserId: w.targetUserId,
        ciphertext: Buffer.from(w.ciphertext, 'base64'),
        senderDeviceId: w.senderDeviceId,
      })),
    });
  }
}
