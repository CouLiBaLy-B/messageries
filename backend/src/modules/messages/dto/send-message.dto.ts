import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string;
}

export class ListMessagesQueryDto {
  @IsOptional() @IsString() afterSequence?: string;
  @IsOptional() @IsString() beforeSequence?: string;
  @IsOptional() @IsString() limit?: string;
}

export class MarkReadDto {
  @IsString() uptoSequence!: string;
}
