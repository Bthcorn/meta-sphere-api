import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListSessionFilesDto {
  @ApiPropertyOptional({ description: 'Text search across file name' })
  @IsOptional()
  @IsString()
  search?: string;
}
