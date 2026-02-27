import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { ReactMessageDto } from './dto/react-message.dto';
import { CurrentUser } from 'src/auth/decorator/current-user.decorator';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

@ApiTags('messages')
@ApiBearerAuth('JWT-auth')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('room/:roomId')
  @ApiOperation({ summary: 'Get room chat history (last 100, paginated)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String, description: 'ISO timestamp for cursor-based pagination' })
  @ApiResponse({ status: 200, description: 'Room messages returned.' })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  getRoomMessages(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10), 1), 100) : 100;
    return this.messagesService.getRoomMessages(roomId, parsedLimit, cursor);
  }

  @Get('direct/:userId')
  @ApiOperation({ summary: 'Get DM thread with a user' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String, description: 'ISO timestamp for cursor-based pagination' })
  @ApiResponse({ status: 200, description: 'DM thread returned.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  getDirectMessages(
    @CurrentUser() user: JwtUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10), 1), 100) : 100;
    return this.messagesService.getDirectMessages(user.userId, userId, parsedLimit, cursor);
  }

  @Post()
  @ApiOperation({ summary: 'Send a message (room or DM)' })
  @ApiResponse({ status: 201, description: 'Message sent.' })
  @ApiResponse({ status: 400, description: 'Invalid payload.' })
  @ApiResponse({ status: 404, description: 'Room or recipient not found.' })
  send(@CurrentUser() user: JwtUser, @Body() dto: CreateMessageDto) {
    return this.messagesService.send(user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit own message' })
  @ApiResponse({ status: 200, description: 'Message updated.' })
  @ApiResponse({ status: 403, description: 'Not the message sender.' })
  @ApiResponse({ status: 404, description: 'Message not found.' })
  edit(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.messagesService.edit(id, user.userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete own message' })
  @ApiResponse({ status: 200, description: 'Message deleted.' })
  @ApiResponse({ status: 403, description: 'Not the message sender.' })
  @ApiResponse({ status: 404, description: 'Message not found.' })
  softDelete(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.messagesService.softDelete(id, user.userId);
  }

  @Post(':id/react')
  @ApiOperation({ summary: 'Add / remove emoji reaction (toggle)' })
  @ApiResponse({ status: 200, description: 'Reaction toggled.' })
  @ApiResponse({ status: 404, description: 'Message not found.' })
  react(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactMessageDto,
  ) {
    return this.messagesService.react(id, user.userId, dto.emoji);
  }
}
