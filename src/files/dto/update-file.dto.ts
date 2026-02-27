import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  Min,
  Max,
  MaxLength,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { FileCategory } from 'src/generated/prisma/client';

export class UpdateFileDto {
  @ApiPropertyOptional({ description: 'Updated description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: FileCategory })
  @IsOptional()
  @IsEnum(FileCategory)
  category?: FileCategory;

  @ApiPropertyOptional({ description: 'Updated tags', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Subject name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @ApiPropertyOptional({ description: 'Target year level (1–4)', minimum: 1, maximum: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  yearLevel?: number;

  @ApiPropertyOptional({ description: 'Visibility flag' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
