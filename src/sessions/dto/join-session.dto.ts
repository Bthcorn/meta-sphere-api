import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class JoinSessionDto {
  @ApiProperty({ required: false, description: 'Required only if the session has a password' })
  @IsString()
  @IsOptional()
  password?: string;
}
