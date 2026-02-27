import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class JoinRoomDto {
  @ApiProperty({
    required: false,
    description: 'Required only for PRIVATE rooms',
    example: 'secret123',
  })
  @IsString()
  @IsOptional()
  password?: string;
}
