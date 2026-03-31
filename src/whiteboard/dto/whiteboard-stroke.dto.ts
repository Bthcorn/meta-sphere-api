import {
  IsString,
  IsNumber,
  IsArray,
  IsIn,
  IsOptional,
  IsObject,
} from 'class-validator';

export class WhiteboardStrokeDto {
  @IsString()
  id: string;

  @IsIn(['pen', 'eraser', 'shape', 'code', 'arrow'])
  type: 'pen' | 'eraser' | 'shape' | 'code' | 'arrow';

  @IsArray()
  @IsNumber({}, { each: true })
  points: number[];

  @IsString()
  color: string;

  @IsNumber()
  width: number;

  @IsString()
  userId: string;

  @IsNumber()
  timestamp: number;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}

export class StrokePayloadDto {
  @IsString()
  sessionId: string;

  stroke: WhiteboardStrokeDto;
}

export class StrokeUndoDto {
  @IsString()
  sessionId: string;

  @IsString()
  strokeId: string;
}

export class SessionIdDto {
  @IsString()
  sessionId: string;
}

export class DrawingStateDto {
  @IsString()
  sessionId: string;

  @IsString()
  userId: string;

  @IsString()
  username: string;

  /** true = started drawing, false = stopped */
  isDrawing: boolean;
}
