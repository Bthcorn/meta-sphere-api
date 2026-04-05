import { IsNumber, IsOptional } from 'class-validator';

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
}
