import { IsUUID, IsString } from 'class-validator';

export class SessionFileShareDto {
  @IsUUID()
  fileId: string;

  @IsUUID()
  sessionId: string;
}
