import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RoomsService } from 'src/rooms/rooms.service';
import { CreateRoomDto } from 'src/rooms/dto/create-room.dto';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorator/roles.decorator';
import { CurrentUser } from 'src/auth/decorator/current-user.decorator';
import { UserRole } from 'src/generated/prisma/client';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post('rooms')
  @ApiOperation({ summary: 'Admin: create a new 3D room' })
  @ApiResponse({ status: 201, description: 'Room created.' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  createRoom(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateRoomDto,
  ) {
    return this.roomsService.create(user.userId, dto);
  }
}
