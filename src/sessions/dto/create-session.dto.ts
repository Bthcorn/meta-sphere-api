import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SessionType } from 'src/generated/prisma/client';

export class CreateSessionDto {
  @ApiProperty({ example: 'room-uuid-here', description: 'ID of the room this session belongs to' })
  @IsUUID()
  roomId: string;

  @ApiProperty({ example: 'Algorithms Study Group' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ required: false, example: 'Covering sorting algorithms tonight.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: SessionType, example: SessionType.STUDY })
  @IsEnum(SessionType)
  type: SessionType;

  @ApiProperty({ required: false, example: '2026-03-01T18:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  scheduledStartTime?: string;

  @ApiProperty({ required: false, example: 'studypass', description: 'Optional password to restrict entry' })
  @IsString()
  @MinLength(4)
  @IsOptional()
  password?: string;
}
