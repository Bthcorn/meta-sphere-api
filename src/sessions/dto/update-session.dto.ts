import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSessionDto {
  @ApiProperty({ required: false, example: 'Updated Session Title' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ required: false, example: 'Updated description.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false, description: 'Lock prevents new participants from joining' })
  @IsBoolean()
  @IsOptional()
  isLocked?: boolean;
}
