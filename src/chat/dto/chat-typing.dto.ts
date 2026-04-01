import { IsUUID, IsOptional, IsBoolean } from 'class-validator';

export class ChatTypingDto {
  @IsUUID()
  roomId: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @IsBoolean()
  isTyping?: boolean; // true = started, false = stopped
}
