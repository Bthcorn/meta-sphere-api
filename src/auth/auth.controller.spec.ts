import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserRole } from 'src/generated/prisma/client';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const loginDto = { username: 'alice', password: 'plaintext' };

const registerDto = {
  username: 'alice',
  password: 'plaintext',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Smith',
};

const authResponse = {
  access_token: 'signed-jwt-token',
  user: { id: 'user-uuid-1', username: 'alice', role: UserRole.USER },
};

// ── Mock service ──────────────────────────────────────────────────────────────

const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── POST /auth/register ───────────────────────────────────────────────────

  describe('register', () => {
    it('should call service.register and return the auth response', async () => {
      mockAuthService.register.mockResolvedValue(authResponse);

      const result = await controller.register(registerDto);

      expect(mockAuthService.register).toHaveBeenCalledWith(registerDto);
      expect(result.access_token).toBe('signed-jwt-token');
      expect(result.user.username).toBe('alice');
    });

    it('should propagate ConflictException when username is taken', async () => {
      mockAuthService.register.mockRejectedValue(
        new ConflictException('Username already exists'),
      );

      await expect(controller.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── POST /auth/login ──────────────────────────────────────────────────────

  describe('login', () => {
    it('should call service.login and return the auth response', async () => {
      mockAuthService.login.mockResolvedValue(authResponse);

      const result = await controller.login(loginDto);

      expect(mockAuthService.login).toHaveBeenCalledWith(loginDto);
      expect(result.access_token).toBe('signed-jwt-token');
      expect(result.user.role).toBe(UserRole.USER);
    });

    it('should propagate UnauthorizedException for invalid credentials', async () => {
      mockAuthService.login.mockRejectedValue(
        new UnauthorizedException('Invalid credentials'),
      );

      await expect(controller.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── POST /auth/logout ─────────────────────────────────────────────────────

  describe('logout', () => {
    it('should call service.logout and return the success message', async () => {
      mockAuthService.logout.mockResolvedValue({ message: 'Logout successful' });

      const result = await controller.logout({});

      expect(mockAuthService.logout).toHaveBeenCalledTimes(1);
      expect(result.message).toBe('Logout successful');
    });
  });

  // ── GET /auth/profile ─────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('should return the user attached to the request by the JWT guard', () => {
      const req = {
        user: { userId: 'user-uuid-1', username: 'alice', role: UserRole.USER },
      };

      const result = controller.getProfile(req);

      expect(result).toEqual(req.user);
    });
  });
});
