import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateAvatarDto {
  @ApiProperty({
    description: 'The avatar preset identifier',
    example: 'avatar3',
  })
  @IsString()
  @IsNotEmpty()
  avatarPreset: string;
}
