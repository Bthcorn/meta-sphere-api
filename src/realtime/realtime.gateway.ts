import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
import { StateService } from './state.service';
import { Position } from './dto/position';

@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private jwtSecret: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly stateService: StateService,
  ) {
    const jwtSecret = this.configService.get<string>('JWT_ACCESS_TOKEN_SECRET');

    if (!jwtSecret || typeof jwtSecret !== 'string') {
      throw new Error('JWT_ACCESS_TOKEN_SECRET is not defined');
    }

    this.jwtSecret = jwtSecret;
  }

  /**
   * Connects the new into the realtime gateway, authenticating the user with
   * JWT and adding the connection to the state service.
   *
   * Moreover:
   * - Emits the current state of all users to the newly connected client
   * - Broadcasts the new user connection to all other clients
   */
  handleConnection(client: Socket) {
    const token = client.handshake.query['token'];

    if (typeof token !== 'string') {
      client.disconnect();

      throw new Error('Authentication token missing');
    }

    const payload = this.jwtService.verify<{ sub: string }>(token, {
      secret: this.jwtSecret,
    });

    // Store the connection in the state service
    this.stateService.newConnection(client.id, payload.sub);

    client.emit('current_state', this.stateService.getAllStates());
    client.broadcast.emit(
      'user_connected',
      this.stateService.getUserState(client.id),
    );
  }

  /**
   * Removes the disconnected client from the state service.
   *
   * - Broadcasts the user disconnection to all other clients
   */
  handleDisconnect(client: Socket) {
    const userId = this.stateService.disconnect(client.id);
    this.server.emit('user_disconnected', userId);
  }

  @SubscribeMessage('update_position')
  handleUpdatePosition(
    @ConnectedSocket() client: Socket,
    @MessageBody() position: Position,
  ) {
    const shouldUpdate = this.stateService.updatePosition(client.id, position);

    if (shouldUpdate) {
      client.broadcast.emit(
        'user_moved',
        this.stateService.getUserState(client.id),
      );
    }
  }
}
