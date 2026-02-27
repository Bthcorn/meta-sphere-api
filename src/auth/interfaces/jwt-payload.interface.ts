import { UserRole } from 'src/generated/prisma/client';

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
}
