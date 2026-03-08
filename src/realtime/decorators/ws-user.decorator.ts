import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';
import { WS_USER_KEY } from '../guards/ws-jwt.guard';

/**
 * Extracts the authenticated user from the WebSocket client.
 * Use with @UseGuards(WsJwtGuard) on the handler.
 */
export const WsUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser => {
    const client = ctx.switchToWs().getClient<{ data: Record<string, unknown> }>();
    const user = client.data[WS_USER_KEY] as JwtUser | undefined;

    if (!user) {
      throw new Error('WsUser decorator requires WsJwtGuard to be applied');
    }

    return user;
  },
);
