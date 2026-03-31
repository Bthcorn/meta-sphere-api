import { IsString, IsNumber } from 'class-validator';

export class CursorMoveDto {
  @IsString()
  sessionId: string;

  @IsNumber()
  x: number;

  @IsNumber()
  y: number;

  @IsString()
  userId: string;

  @IsString()
  username: string;
}
