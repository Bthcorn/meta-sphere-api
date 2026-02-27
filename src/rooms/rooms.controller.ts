import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { JoinRoomDto } from './dto/join-room.dto';
import { CurrentUser } from 'src/auth/decorator/current-user.decorator';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

@ApiTags('rooms')
@ApiBearerAuth('JWT-auth')
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  @ApiOperation({ summary: 'List all active rooms with current occupancy' })
  @ApiResponse({ status: 200, description: 'Active rooms returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  findAll() {
    return this.roomsService.findAllActive();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single room details' })
  @ApiResponse({ status: 200, description: 'Room returned.' })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  findOne(@Param('id') id: string) {
    return this.roomsService.findById(id);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enter a room (validates password if PRIVATE)' })
  @ApiResponse({ status: 200, description: 'Joined room successfully.' })
  @ApiResponse({ status: 400, description: 'Password required.' })
  @ApiResponse({ status: 403, description: 'Incorrect password.' })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  @ApiResponse({ status: 409, description: 'Room at full capacity.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  join(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: JoinRoomDto,
  ) {
    return this.roomsService.joinRoom(id, user.userId, dto.password);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave a room' })
  @ApiResponse({ status: 200, description: 'Left room successfully.' })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  leave(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.roomsService.leaveRoom(id, user.userId);
  }

  @Get(':id/users')
  @ApiOperation({ summary: 'List users currently in a room' })
  @ApiResponse({ status: 200, description: 'Users in room returned.' })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getUsersInRoom(@Param('id') id: string) {
    return this.roomsService.getUsersInRoom(id);
  }
}
