import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from 'src/generated/prisma/client';

export class UpdateStatusDto {
  @ApiProperty({
    description: 'The new status of the user',
    enum: UserStatus,
    example: UserStatus.AVAILABLE,
  })
  @IsEnum(UserStatus)
  status: UserStatus;
}
