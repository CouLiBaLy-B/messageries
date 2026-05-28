import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsMimeType, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UuidPipe } from '../../common/pipes/uuid.pipe';
import { AttachmentsService } from './attachments.service';

class PresignDto {
  @IsUUID() conversationId!: string;
  @IsString() @MaxLength(255) filename!: string;
  @IsMimeType() mimeType!: string;
  @IsInt() @Min(1) sizeBytes!: number;
}

@ApiTags('attachments')
@ApiBearerAuth()
@Controller('attachments')
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('presign')
  presign(@Body() dto: PresignDto, @CurrentUser() user: AuthUser) {
    return this.attachments.presignUpload({
      userId: user.sub,
      userRole: user.role,
      conversationId: dto.conversationId,
      filename: dto.filename,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
    });
  }

  @Post(':id/finalize')
  finalize(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.attachments.finalize(id, user.sub);
  }

  @Get(':id/download-url')
  download(@Param('id', UuidPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.attachments.getDownloadUrl({
      attachmentId: id,
      userId: user.sub,
      userRole: user.role,
    });
  }
}
