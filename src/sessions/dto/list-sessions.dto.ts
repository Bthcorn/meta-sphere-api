import { IsOptional, IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SessionStatus } from 'src/generated/prisma/client';

export class ListSessionsDto {
  @ApiProperty({ required: false, example: 'room-uuid-here' })
  @IsUUID()
  @IsOptional()
  roomId?: string;

  @ApiProperty({ required: false, enum: SessionStatus, example: SessionStatus.ACTIVE })
  @IsEnum(SessionStatus)
  @IsOptional()
  status?: SessionStatus;
}
