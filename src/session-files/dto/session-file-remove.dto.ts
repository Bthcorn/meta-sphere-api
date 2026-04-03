import { IsUUID } from 'class-validator';

export class SessionFileRemoveDto {
  @IsUUID()
  fileId: string;

  @IsUUID()
  sessionId: string;
}
