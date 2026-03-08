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
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StateService } from './state.service';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { Position } from './dto/position';

@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly jwtSecret: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly stateService: StateService,
  ) {
    const secret = this.configService.get<string>('JWT_ACCESS_TOKEN_SECRET');
    if (!secret || typeof secret !== 'string') {
      throw new Error('JWT_ACCESS_TOKEN_SECRET is not defined');
    }
    this.jwtSecret = secret;
  }

  handleConnection(client: Socket): void {
    const token = client.handshake.query?.token ?? client.handshake.auth?.token;
    if (typeof token !== 'string') {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify<{ sub: string }>(token, {
        secret: this.jwtSecret,
      });
      this.stateService.newConnection(client.id, payload.sub);

      client.emit('current_state', this.stateService.getAllStates());
      client.broadcast.emit(
        'user_connected',
        this.stateService.getUserState(client.id),
      );
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = this.stateService.disconnect(client.id);
    this.server.emit('user_disconnected', userId);
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('update_position')
  handleUpdatePosition(
    @ConnectedSocket() client: Socket,
    @MessageBody() position: Position,
  ): void {
    const shouldUpdate = this.stateService.updatePosition(client.id, position);
    if (shouldUpdate) {
      client.broadcast.emit(
        'user_moved',
        this.stateService.getUserState(client.id),
      );
    }
  }
}
