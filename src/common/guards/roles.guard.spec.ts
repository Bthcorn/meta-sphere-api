import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from 'src/generated/prisma/client';
import { ROLES_KEY } from '../decorator/roles.decorator';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildContext(user: Partial<JwtUser> | null, requiredRoles: UserRole[] | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn() },
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access when no @Roles() metadata is set', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = buildContext({ role: UserRole.USER }, undefined);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow access when @Roles() is an empty array', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    const ctx = buildContext({ role: UserRole.USER }, []);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow an ADMIN user to access an ADMIN-only route', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const ctx = buildContext(
      { userId: 'u1', username: 'admin', role: UserRole.ADMIN },
      [UserRole.ADMIN],
    );

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw ForbiddenException when a USER tries to access an ADMIN-only route', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const ctx = buildContext(
      { userId: 'u2', username: 'alice', role: UserRole.USER },
      [UserRole.ADMIN],
    );

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException when user object is missing from the request', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const ctx = buildContext(null, [UserRole.ADMIN]);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should read metadata from both handler and class via getAllAndOverride', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const ctx = buildContext(
      { userId: 'u1', username: 'admin', role: UserRole.ADMIN },
      [UserRole.ADMIN],
    );

    guard.canActivate(ctx);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      ROLES_KEY,
      [expect.anything(), expect.anything()],
    );
  });
});
