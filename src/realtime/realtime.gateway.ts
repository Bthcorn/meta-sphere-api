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
import { AvatarAppearance } from './dto/avatar-appearance';
import { SessionsService } from '../sessions/sessions.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

const COMMON_AREA_ID = 'common_area';

@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly jwtSecret: string;
  private readonly userSockets = new Map<string, Socket>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly stateService: StateService,
    private readonly sessionsService: SessionsService,
    private readonly eventEmitter: EventEmitter2,
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
      const payload = this.jwtService.verify<{ sub: string; username: string }>(
        token,
        {
          secret: this.jwtSecret,
        },
      );
      const userId = payload.sub;
      const username = payload.username ?? userId;

      // If this user already has an active connection (e.g. page refresh or race
      // between disconnect and reconnect), gracefully take over: clean up the old
      // socket so the new one can proceed without being rejected.
      const existingSocket = this.userSockets.get(userId);
      if (existingSocket && existingSocket.id !== client.id) {
        try {
          this.stateService.disconnect(existingSocket.id);
        } catch {
          // state may already be gone if the old disconnect was processed first
        }
        this.userSockets.delete(userId);
        existingSocket.disconnect(true);
      }

      let roomId = COMMON_AREA_ID;
      const activeSession =
        await this.sessionsService.getActiveUserSession(userId);

      if (activeSession) {
        roomId = activeSession.id;
      }

      this.stateService.newConnection(client.id, userId, username, roomId);
      await client.join(roomId);
      this.userSockets.set(userId, client);

      this.eventEmitter.emit('user.connected', { userId });

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
        this.eventEmitter.emit('user.disconnected', { userId });
      }

      this.server.to(roomId).emit('user_disconnected', userId);
    } catch {
      // client might not be registered if JWT verification failed
    }
  }

  @OnEvent('session.joined')
  async handleSessionJoined(payload: {
    userId: string;
    sessionId: string;
  }): Promise<void> {
    await this.switchUserRoom(payload.userId, payload.sessionId);
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
      this.stateService.changeRoom(socket.id, newRoomId);

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

  /** Client can request a fresh presence snapshot without reconnecting. */
  @UseGuards(WsJwtGuard)
  @SubscribeMessage('request_state')
  handleRequestState(@ConnectedSocket() client: Socket): void {
    try {
      const state = this.stateService.getUserState(client.id);
      client.emit(
        'current_state',
        this.stateService.getAllStates(state.currentUserRoom),
      );
    } catch {
      // state not found — ignore
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

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('update_avatar')
  handleUpdateAvatar(
    @ConnectedSocket() client: Socket,
    @MessageBody() appearance: AvatarAppearance,
  ): void {
    try {
      const state = this.stateService.getUserState(client.id);
      state.setAvatar(appearance);
      client.to(state.currentUserRoom).emit('user_avatar_updated', {
        userId: state.asPayload().userId,
        avatar: appearance,
      });
    } catch {
      // state not found — ignore
    }
  }

  @OnEvent('session.ended')
  async handleSessionEnded(payload: { sessionId: string }): Promise<void> {
    const { sessionId } = payload;

    // Tell all clients in this session room that it ended
    // This fires BEFORE we move them, so the client receives it while still subscribed
    this.server.to(sessionId).emit('session:ended', { sessionId });

    // Move every socket in this room back to common area
    const usersInRoom = this.stateService.getAllStates(sessionId);
    for (const userState of usersInRoom) {
      await this.switchUserRoom(userState.userId, COMMON_AREA_ID);
    }
  }

  @OnEvent('friend.updated')
  handleFriendUpdated(payload: { userIds: string[] }): void {
    for (const userId of payload.userIds) {
      const socket = this.userSockets.get(userId);
      if (socket) {
        socket.emit('friend_requests:updated');
      }
    }
  }

  @OnEvent('session.invite_friends')
  handleSessionInviteFriends(payload: {
    sessionId: string;
    roomId: string;
    hostId: string;
    invitedFriendsIds: string[];
    sessionTitle: string;
    sessionType: string;
  }): void {
    for (const friendId of payload.invitedFriendsIds) {
      const socket = this.userSockets.get(friendId);
      if (socket) {
        const inviteToken = this.jwtService.sign(
          { sessionId: payload.sessionId, invitedUserId: friendId },
          { secret: this.jwtSecret, expiresIn: '1m' },
        );

        socket.emit('session_invitation', {
          sessionId: payload.sessionId,
          roomId: payload.roomId,
          hostId: payload.hostId,
          sessionTitle: payload.sessionTitle,
          sessionType: payload.sessionType,
          inviteToken,
        });
      }
    }
  }
}
