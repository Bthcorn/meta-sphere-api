import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReactMessageDto {
  @ApiProperty({ description: 'Emoji character to react with', example: '👍' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  emoji: string;
}
