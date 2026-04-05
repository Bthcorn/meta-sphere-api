import { IsOptional, IsString } from 'class-validator';

export class AvatarAppearance {
  @IsOptional()
  @IsString()
  skinColor?: string;

  @IsOptional()
  @IsString()
  shirtColorId?: string;

  @IsOptional()
  @IsString()
  glassesId?: string;

  @IsOptional()
  @IsString()
  hatId?: string;
}
