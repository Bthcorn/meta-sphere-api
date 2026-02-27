import {
  IsString,
  IsOptional,
  IsUUID,
  IsNotEmpty,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType } from 'src/generated/prisma/client';

export class CreateMessageDto {
  @ApiProperty({ description: 'Message content', maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content: string;

  @ApiPropertyOptional({ description: 'Room ID for room messages' })
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional({ description: 'Recipient user ID for direct messages' })
  @IsOptional()
  @IsUUID()
  recipientId?: string;

  @ApiPropertyOptional({ enum: MessageType, default: MessageType.TEXT })
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;
}
