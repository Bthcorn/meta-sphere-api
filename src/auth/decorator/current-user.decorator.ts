// src/auth/decorators/user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtUser } from '../interfaces/jwt-user.interface';

export const CurrentUser = createParamDecorator(
  (_data: string, ctx: ExecutionContext): JwtUser => {
    const request = ctx.switchToHttp().getRequest<object>();

    return request['user'] as JwtUser;
  },
);
