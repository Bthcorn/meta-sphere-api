import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

export const WS_USER_KEY = 'user';

@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly secret: string;

  constructor(
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    const secret = configService.get<string>('JWT_ACCESS_TOKEN_SECRET');
    if (!secret || typeof secret !== 'string') {
      throw new Error('JWT_ACCESS_TOKEN_SECRET is not defined');
    }
    this.secret = secret;
  }

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();
    const token =
      client.handshake.query?.token ?? client.handshake.auth?.token;

    if (typeof token !== 'string') {
      throw new WsException('Authentication token missing');
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.secret,
      });
      const user: JwtUser = {
        userId: payload.sub,
        username: payload.username,
        role: payload.role,
      };
      client.data[WS_USER_KEY] = user;
      return true;
    } catch {
      throw new WsException('Invalid or expired token');
    }
  }
}
