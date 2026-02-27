import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateMessageDto {
  @ApiProperty({ description: 'Updated message content', maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content: string;
}
