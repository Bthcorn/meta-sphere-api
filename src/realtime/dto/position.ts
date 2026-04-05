import { IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

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

export class Position {
  @IsNumber()
  x: number;

  @IsNumber()
  y: number;

  @IsNumber()
  z: number;

  /** Y-axis rotation (yaw) in radians — the direction the avatar is facing. */
  @IsOptional()
  @IsNumber()
  rotationY?: number;

  /** Grouped avatar appearance — piggybacked on the position payload. */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => AvatarAppearance)
  avatar?: AvatarAppearance;
}
