import { IsNumber } from 'class-validator';

export class Position {
  @IsNumber()
  x: number;

  @IsNumber()
  y: number;

  @IsNumber()
  z: number;
}
