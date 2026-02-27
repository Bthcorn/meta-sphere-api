import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UserStatus, UserRole } from 'src/generated/prisma/client';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

const jwtUser: JwtUser = { userId: 'user-uuid-1', username: 'alice', role: UserRole.USER };

const mockUser = {
  id: 'user-uuid-1',
  email: 'alice@example.com',
  username: 'alice',
  password: '$2b$10$hashedpassword',
  firstName: 'Alice',
  lastName: 'Smith',
  profilePicture: null,
  avatarPreset: 'avatar1',
  status: UserStatus.AVAILABLE,
  lastActive: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const { password: _, ...safeUser } = mockUser;

const mockUsersService = {
  findById: jest.fn(),
  updateUser: jest.fn(),
  updateAvatar: jest.fn(),
  updateStatus: jest.fn(),
  findOnlineUsers: jest.fn(),
};

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── GET /users/me ─────────────────────────────────────────────────────

  describe('getMe', () => {
    it('should return the current user without password', async () => {
      mockUsersService.findById.mockResolvedValue(mockUser);

      const result = await controller.getMe(jwtUser);

      expect(mockUsersService.findById).toHaveBeenCalledWith('user-uuid-1');
      expect(result).toEqual(safeUser);
      expect(result).not.toHaveProperty('password');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockUsersService.findById.mockResolvedValue(null);

      await expect(controller.getMe(jwtUser)).rejects.toThrow(NotFoundException);
    });
  });

  // ── PUT /users/me ─────────────────────────────────────────────────────

  describe('updateMe', () => {
    it('should update profile and return result without password', async () => {
      const dto = { firstName: 'Alicia' };
      const updated = { ...mockUser, firstName: 'Alicia' };
      mockUsersService.updateUser.mockResolvedValue(updated);

      const result = await controller.updateMe(jwtUser, dto);

      expect(mockUsersService.updateUser).toHaveBeenCalledWith('user-uuid-1', dto);
      expect(result).not.toHaveProperty('password');
      expect(result.firstName).toBe('Alicia');
    });
  });

  // ── PATCH /users/me/avatar ────────────────────────────────────────────

  describe('updateAvatar', () => {
    it('should update avatarPreset and return result without password', async () => {
      const updated = { ...mockUser, avatarPreset: 'avatar3' };
      mockUsersService.updateAvatar.mockResolvedValue(updated);

      const result = await controller.updateAvatar(jwtUser, { avatarPreset: 'avatar3' });

      expect(mockUsersService.updateAvatar).toHaveBeenCalledWith('user-uuid-1', 'avatar3');
      expect(result).not.toHaveProperty('password');
      expect(result.avatarPreset).toBe('avatar3');
    });
  });

  // ── PATCH /users/me/status ────────────────────────────────────────────

  describe('updateStatus', () => {
    it('should update status and return result without password', async () => {
      const updated = { ...mockUser, status: UserStatus.FOCUS };
      mockUsersService.updateStatus.mockResolvedValue(updated);

      const result = await controller.updateStatus(jwtUser, { status: UserStatus.FOCUS });

      expect(mockUsersService.updateStatus).toHaveBeenCalledWith('user-uuid-1', UserStatus.FOCUS);
      expect(result).not.toHaveProperty('password');
      expect(result.status).toBe(UserStatus.FOCUS);
    });
  });

  // ── GET /users/online ─────────────────────────────────────────────────

  describe('getOnlineUsers', () => {
    it('should return list of users without passwords', async () => {
      mockUsersService.findOnlineUsers.mockResolvedValue([mockUser]);

      const result = await controller.getOnlineUsers();

      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('password');
      expect(result[0].username).toBe('alice');
    });

    it('should return an empty array when no users are online', async () => {
      mockUsersService.findOnlineUsers.mockResolvedValue([]);

      const result = await controller.getOnlineUsers();

      expect(result).toEqual([]);
    });
  });

  // ── GET /users/:id ────────────────────────────────────────────────────

  describe('findById', () => {
    it('should return a user by id without password', async () => {
      mockUsersService.findById.mockResolvedValue(mockUser);

      const result = await controller.findById('user-uuid-1');

      expect(mockUsersService.findById).toHaveBeenCalledWith('user-uuid-1');
      expect(result).not.toHaveProperty('password');
      expect(result.id).toBe('user-uuid-1');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockUsersService.findById.mockResolvedValue(null);

      await expect(controller.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
