import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import { ConversationAccessGuard } from './guards/conversation-access.guard';
import { UuidPipe } from '../../common/pipes/uuid.pipe';

@ApiTags('conversations')
@ApiBearerAuth()
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  /** Liste des conversations de l'utilisateur courant */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.conversations.listForUser(user.sub);
  }

  /** Crée (ou récupère) LA conversation liée à une commande */
  @Post('by-order/:orderId')
  async openByOrder(
    @Param('orderId', UuidPipe) orderId: string,
    @CurrentUser() user: AuthUser,
  ) {
    // L'autorisation "user ∈ {customer, seller, support, admin}" est faite
    // implicitement par le fait que getOrCreate ne crée que si l'order existe
    // et que les participants ajoutés sont le customer + seller de cette commande.
    // L'accès ultérieur est protégé par ConversationAccessGuard.
    const conv = await this.conversations.getOrCreateForOrder(orderId, user.sub);
    return conv;
  }

  /** Détail d'une conversation (autorisation enforced par le guard) */
  @Get(':conversationId')
  @UseGuards(ConversationAccessGuard)
  async getOne(@Req() req: any) {
    const participants = await this.conversations.listParticipants(
      req.conversation.id,
    );
    return { ...req.conversation, participants, myRole: req.participantRole };
  }
}
