import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  MaxLength,
} from 'class-validator';

export class ChatSendDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @IsUUID()
  roomId: string; // always required — every zone has a roomId

  @IsOptional()
  @IsUUID()
  sessionId?: string; // present only for session-scoped chat
}
