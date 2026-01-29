import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateAvatarDto {
  @ApiProperty({
    description: 'The URL of the new avatar image',
    example: 'https://example.com/avatar.jpg',
  })
  @IsString()
  @IsNotEmpty()
  avatarUrl: string;
}
