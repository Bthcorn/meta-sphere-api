import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { JoinSessionDto } from './dto/join-session.dto';
import { ListSessionsDto } from './dto/list-sessions.dto';
import { CurrentUser } from 'src/auth/decorator/current-user.decorator';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';
import { SessionStatus } from 'src/generated/prisma/client';

@ApiTags('sessions')
@ApiBearerAuth('JWT-auth')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'List sessions (filterable by roomId, status)' })
  @ApiQuery({ name: 'roomId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: SessionStatus })
  @ApiResponse({ status: 200, description: 'Sessions returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  findAll(@Query() query: ListSessionsDto) {
    return this.sessionsService.findAll(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a session inside a room' })
  @ApiResponse({ status: 201, description: 'Session created.' })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateSessionDto) {
    return this.sessionsService.create(user.userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get session details' })
  @ApiResponse({ status: 200, description: 'Session returned.' })
  @ApiResponse({ status: 404, description: 'Session not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  findOne(@Param('id') id: string) {
    return this.sessionsService.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update session (title, description, lock) — host only' })
  @ApiResponse({ status: 200, description: 'Session updated.' })
  @ApiResponse({ status: 403, description: 'Not the host.' })
  @ApiResponse({ status: 404, description: 'Session not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.sessionsService.update(id, user.userId, dto);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Host starts the session' })
  @ApiResponse({ status: 200, description: 'Session started.' })
  @ApiResponse({ status: 403, description: 'Not the host.' })
  @ApiResponse({ status: 409, description: 'Session is not in SCHEDULED state.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  start(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.sessionsService.start(id, user.userId);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Host ends the session' })
  @ApiResponse({ status: 200, description: 'Session ended.' })
  @ApiResponse({ status: 403, description: 'Not the host.' })
  @ApiResponse({ status: 409, description: 'Session is not ACTIVE.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  end(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.sessionsService.end(id, user.userId);
  }

  @Post(':id/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Join a session as participant' })
  @ApiResponse({ status: 200, description: 'Joined session.' })
  @ApiResponse({ status: 400, description: 'Password required.' })
  @ApiResponse({ status: 403, description: 'Kicked or wrong password.' })
  @ApiResponse({ status: 409, description: 'Session locked or not joinable.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  join(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: JoinSessionDto,
  ) {
    return this.sessionsService.join(id, user.userId, dto.password);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave a session' })
  @ApiResponse({ status: 200, description: 'Left session.' })
  @ApiResponse({ status: 409, description: 'Not an active participant.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  leave(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.sessionsService.leave(id, user.userId);
  }

  @Get(':id/participants')
  @ApiOperation({ summary: 'List session participants' })
  @ApiResponse({ status: 200, description: 'Participants returned.' })
  @ApiResponse({ status: 404, description: 'Session not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getParticipants(@Param('id') id: string) {
    return this.sessionsService.getParticipants(id);
  }

  @Delete(':id/participants/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Host kicks a participant' })
  @ApiResponse({ status: 200, description: 'Participant removed.' })
  @ApiResponse({ status: 400, description: 'Host cannot kick themselves.' })
  @ApiResponse({ status: 403, description: 'Not the host.' })
  @ApiResponse({ status: 404, description: 'Participant not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  kickParticipant(
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.sessionsService.kickParticipant(id, user.userId, targetUserId);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'Get session event log' })
  @ApiResponse({ status: 200, description: 'Logs returned.' })
  @ApiResponse({ status: 404, description: 'Session not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  getLogs(@Param('id') id: string) {
    return this.sessionsService.getLogs(id);
  }
}
