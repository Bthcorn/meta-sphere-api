import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import JwtAccessGuard from '../auth/decorator/jwt-access-auth.guard';
import { MessagesService } from './messages.service';
import { GetMessagesDto } from './dto/get-messages.dto';

@UseGuards(JwtAccessGuard)
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  // GET /api/messages/room/:roomId?limit=50&before=<ISO>
  @Get('room/:roomId')
  getRoomMessages(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: GetMessagesDto,
  ) {
    return this.messages.getRoomMessages(roomId, query.limit, query.before);
  }

  // GET /api/messages/session/:sessionId?limit=100&before=<ISO>
  @Get('session/:sessionId')
  getSessionMessages(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query() query: GetMessagesDto,
  ) {
    return this.messages.getSessionMessages(
      sessionId,
      query.limit,
      query.before,
    );
  }

  // DELETE /api/messages/:id  (own messages only — service enforces senderId)
  @Delete(':id')
  deleteMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: { sub: string } },
  ) {
    return this.messages.softDelete(id, req.user.sub);
  }
}
