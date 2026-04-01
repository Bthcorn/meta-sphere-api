import { UseGuards } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WS_USER_KEY, WsJwtGuard } from '../realtime/guards/ws-jwt.guard';
import { MessagesService } from '../messages/messages.service';
import { ChatSendDto } from './dto/chat-send.dto';
import { ChatTypingDto } from './dto/chat-typing.dto';

@UseGuards(WsJwtGuard)
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly messagesService: MessagesService) {}

  @SubscribeMessage('chat:send')
  async handleChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ChatSendDto,
  ): Promise<void> {
    const userId = client.data[WS_USER_KEY]?.userId as string;

    const message = await this.messagesService.createMessage({
      content: dto.content,
      senderId: userId,
      roomId: dto.roomId,
      sessionId: dto.sessionId,
    });

    const targetRoom = dto.sessionId
      ? `session:${dto.sessionId}`
      : `room:${dto.roomId}`;

    this.server.to(targetRoom).emit('chat:message', message);
  }

  @SubscribeMessage('chat:typing')
  async handleChatTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: ChatTypingDto,
  ): Promise<void> {
    const userId = client.data[WS_USER_KEY]?.userId as string;
    const username = client.data[WS_USER_KEY]?.username as string;

    const scope = dto.sessionId
      ? `session:${dto.sessionId}`
      : `room:${dto.roomId}`;

    if (dto.isTyping === false) {
      await this.messagesService.clearTyping(scope, userId);
    } else {
      await this.messagesService.setTyping(scope, userId, username);
    }

    client.to(scope).emit('chat:typing', {
      userId,
      username,
      isTyping: dto.isTyping !== false,
    });
  }

  @SubscribeMessage('chat:reaction')
  async handleChatReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: { messageId: string; emoji: string },
  ): Promise<void> {
    const userId = client.data[WS_USER_KEY]?.userId as string;

    const updated = await this.messagesService.toggleReaction(
      dto.messageId,
      userId,
      dto.emoji,
    );

    const targetRoom = updated.sessionId
      ? `session:${updated.sessionId}`
      : `room:${updated.roomId}`;

    this.server.to(targetRoom).emit('chat:reaction', {
      messageId: updated.id,
      reactions: updated.reactions,
    });
  }

  @SubscribeMessage('chat:join')
  async handleChatJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: { roomId?: string; sessionId?: string },
  ): Promise<void> {
    const room = dto.sessionId
      ? `session:${dto.sessionId}`
      : `room:${dto.roomId}`;
    await client.join(room);
  }

  @SubscribeMessage('chat:leave')
  async handleChatLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: { roomId?: string; sessionId?: string },
  ): Promise<void> {
    const room = dto.sessionId
      ? `session:${dto.sessionId}`
      : `room:${dto.roomId}`;
    await client.leave(room);
  }
}
