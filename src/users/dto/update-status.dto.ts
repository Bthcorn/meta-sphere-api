import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum UserStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  AWAY = 'AWAY',
  DO_NOT_DISTURB = 'DO_NOT_DISTURB',
}

export class UpdateStatusDto {
  @ApiProperty({
    description: 'The new status of the user',
    enum: UserStatus,
    example: UserStatus.ONLINE,
  })
  @IsEnum(UserStatus)
  status: UserStatus;
}
