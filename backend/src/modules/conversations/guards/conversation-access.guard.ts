import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConversationsService } from '../conversations.service';

/**
 * Guard à appliquer sur tout endpoint qui reçoit :conversationId.
 * Stocke la conversation et le rôle du participant dans req pour les controllers.
 */
@Injectable()
export class ConversationAccessGuard implements CanActivate {
  constructor(private readonly conversations: ConversationsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException('Non authentifié');

    const conversationId =
      req.params?.conversationId ?? req.params?.id ?? req.body?.conversationId;
    if (!conversationId) {
      throw new ForbiddenException('Conversation requise');
    }

    const { conversation, participantRole } = await this.conversations.assertCanAccess(
      user.sub,
      user.role,
      conversationId,
    );
    req.conversation = conversation;
    req.participantRole = participantRole;
    return true;
  }
}
