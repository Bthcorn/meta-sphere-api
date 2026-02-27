import { UserRole } from 'src/generated/prisma/client';

export interface JwtUser {
  userId: string;
  username: string;
  role: UserRole;
}
