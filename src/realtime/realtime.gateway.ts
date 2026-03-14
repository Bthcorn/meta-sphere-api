import { UseGuards } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StateService } from './state.service';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { Position } from './dto/position';
import { SessionsService } from '../sessions/sessions.service';

const COMMON_AREA_ID = 'common_area';

@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly jwtSecret: string;
  private readonly userSockets = new Map<string, Socket>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly stateService: StateService,
    private readonly sessionsService: SessionsService,
  ) {
    const secret = this.configService.get<string>('JWT_ACCESS_TOKEN_SECRET');
    if (!secret || typeof secret !== 'string') {
      throw new Error('JWT_ACCESS_TOKEN_SECRET is not defined');
    }
    this.jwtSecret = secret;
  }

  async handleConnection(client: Socket): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const token = client.handshake.query?.token ?? client.handshake.auth?.token;

    if (typeof token !== 'string') {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify<{ sub: string }>(token, {
        secret: this.jwtSecret,
      });
      const userId = payload.sub;

      let roomId = COMMON_AREA_ID;
      const activeSession =
        await this.sessionsService.getActiveUserSession(userId);

      if (activeSession) {
        roomId = activeSession.id;
      }

      this.stateService.newConnection(client.id, userId, roomId);
      await client.join(roomId);

      const existingSocket = this.userSockets.get(userId);
      if (existingSocket) {
        existingSocket.disconnect();
      }
      this.userSockets.set(userId, client);

      client.emit('current_state', this.stateService.getAllStates(roomId));
      client
        .to(roomId)
        .emit(
          'user_connected',
          this.stateService.getUserStatePayload(client.id),
        );
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    try {
      const state = this.stateService.getUserState(client.id);
      const userId = state.asPayload().userId;
      const roomId = state.currentUserRoom;

      this.stateService.disconnect(client.id);

      if (this.userSockets.get(userId)?.id === client.id) {
        this.userSockets.delete(userId);
      }

      this.server.to(roomId).emit('user_disconnected', userId);
    } catch {
      // client might not be registered if JWT verification failed
    }
  }

  @OnEvent('session.joined')
  async handleSessionJoined(payload: {
    userId: string;
    roomId: string;
  }): Promise<void> {
    await this.switchUserRoom(payload.userId, payload.roomId);
  }

  @OnEvent('session.left')
  async handleSessionLeft(payload: { userId: string }): Promise<void> {
    await this.switchUserRoom(payload.userId, COMMON_AREA_ID);
  }

  private async switchUserRoom(
    userId: string,
    newRoomId: string,
  ): Promise<void> {
    const socket = this.userSockets.get(userId);
    if (!socket) return;

    try {
      const state = this.stateService.getUserState(socket.id);
      const oldRoom = state.currentUserRoom;

      if (oldRoom === newRoomId) return;

      await socket.leave(oldRoom);
      await socket.join(newRoomId);
      state.setRoom(newRoomId);

      // Notify old room
      socket.to(oldRoom).emit('user_disconnected', userId);

      // Update local client with new room state
      socket.emit('current_state', this.stateService.getAllStates(newRoomId));

      // Notify new room
      socket.to(newRoomId).emit('user_connected', state.asPayload());
    } catch {
      // Ignored
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('update_position')
  handleUpdatePosition(
    @ConnectedSocket() client: Socket,
    @MessageBody() position: Position,
  ): void {
    const shouldUpdate = this.stateService.updatePosition(client.id, position);
    if (shouldUpdate) {
      const state = this.stateService.getUserState(client.id);
      client.to(state.currentUserRoom).emit('user_moved', state.asPayload());
    }
  }
}
