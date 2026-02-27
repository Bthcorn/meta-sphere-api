import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RoomType, AccessType } from 'src/generated/prisma/client';

export class CreateRoomDto {
  @ApiProperty({ example: 'Study Hall Alpha' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false, example: 'A quiet space for deep work.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: RoomType, example: RoomType.WORKSPACE })
  @IsEnum(RoomType)
  type: RoomType;

  @ApiProperty({ enum: AccessType, example: AccessType.PUBLIC, required: false })
  @IsEnum(AccessType)
  @IsOptional()
  accessType?: AccessType;

  @ApiProperty({ required: false, minimum: 1, maximum: 100, example: 30 })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  capacity?: number;

  @ApiProperty({ required: false, example: 'secret123' })
  @IsString()
  @MinLength(4)
  @IsOptional()
  password?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  thumbnail?: string;
}
