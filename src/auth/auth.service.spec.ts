import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from 'src/users/users.service';
import { UserRole, UserStatus } from 'src/generated/prisma/client';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

import * as bcrypt from 'bcrypt';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'user-uuid-1',
  username: 'alice',
  password: 'hashed-password',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Smith',
  profilePicture: null,
  avatarPreset: 'avatar1',
  role: UserRole.USER,
  status: UserStatus.AVAILABLE,
  lastActive: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const loginDto = { username: 'alice', password: 'plaintext' };

const registerDto = {
  username: 'alice',
  password: 'plaintext',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Smith',
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUsersService = {
  findByUsername: jest.fn(),
  create: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('signed-jwt-token'),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── validateUser ──────────────────────────────────────────────────────────

  describe('validateUser', () => {
    it('should return the user when credentials are valid', async () => {
      mockUsersService.findByUsername.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser(loginDto);

      expect(mockUsersService.findByUsername).toHaveBeenCalledWith({
        username: 'alice',
      });
      expect(result).toEqual(mockUser);
    });

    it('should throw UnauthorizedException when the password is wrong', async () => {
      mockUsersService.findByUsername.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.validateUser(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when the user does not exist', async () => {
      mockUsersService.findByUsername.mockResolvedValue(null);

      await expect(service.validateUser(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    beforeEach(() => {
      mockUsersService.findByUsername.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    });

    it('should return an access_token and user on successful login', async () => {
      const result = await service.login(loginDto);

      expect(result).toEqual({
        access_token: 'signed-jwt-token',
        user: {
          id: mockUser.id,
          username: mockUser.username,
          role: UserRole.USER,
        },
      });
    });

    it('should sign a JWT payload containing sub, username and role', async () => {
      await service.login(loginDto);

      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id.toString(),
        username: mockUser.username,
        role: UserRole.USER,
      });
    });

    it('should propagate UnauthorizedException for invalid credentials', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── register ──────────────────────────────────────────────────────────────

  describe('register', () => {
    it('should create a user and return an access_token on success', async () => {
      mockUsersService.findByUsername.mockResolvedValue(null);
      mockUsersService.create.mockResolvedValue(mockUser);

      const result = await service.register(registerDto);

      expect(mockUsersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'alice',
          email: 'alice@example.com',
          firstName: 'Alice',
          lastName: 'Smith',
        }),
      );
      expect(result.access_token).toBe('signed-jwt-token');
      expect(result.user.username).toBe('alice');
    });

    it('should sign a JWT payload with sub, username and role after registration', async () => {
      mockUsersService.findByUsername.mockResolvedValue(null);
      mockUsersService.create.mockResolvedValue(mockUser);

      await service.register(registerDto);

      expect(mockJwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id.toString(),
        username: mockUser.username,
        role: UserRole.USER,
      });
    });

    it('should throw ConflictException when the username is already taken', async () => {
      mockUsersService.findByUsername.mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockUsersService.create).not.toHaveBeenCalled();
    });
  });

  // ── logout ────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('should return a logout success message', async () => {
      const result = await service.logout();

      expect(result).toEqual({ message: 'Logout successful' });
    });
  });
});
