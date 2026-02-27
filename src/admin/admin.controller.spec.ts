import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { RoomsService } from 'src/rooms/rooms.service';
import { RoomType, AccessType, UserRole } from 'src/generated/prisma/client';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const adminUser: JwtUser = {
  userId: 'admin-1',
  username: 'superadmin',
  role: UserRole.ADMIN,
};

const mockRoom = {
  id: 'room-1',
  name: 'Main Hall',
  description: 'The primary collaboration space',
  type: RoomType.WORKSPACE,
  accessType: AccessType.PUBLIC,
  capacity: 30,
  isActive: true,
  thumbnail: null,
  createdById: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  occupancy: 0,
};

// ── Mock service ──────────────────────────────────────────────────────────────

const mockRoomsService = {
  create: jest.fn(),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('AdminController', () => {
  let controller: AdminController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: RoomsService, useValue: mockRoomsService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── POST /admin/rooms ─────────────────────────────────────────────────────

  describe('createRoom', () => {
    it('should create a room and return it with occupancy', async () => {
      mockRoomsService.create.mockResolvedValue(mockRoom);
      const dto = {
        name: 'Main Hall',
        type: RoomType.WORKSPACE,
        accessType: AccessType.PUBLIC,
      };

      const result = await controller.createRoom(adminUser, dto);

      expect(mockRoomsService.create).toHaveBeenCalledWith('admin-1', dto);
      expect(result.name).toBe('Main Hall');
      expect(result.occupancy).toBe(0);
    });

    it('should pass createdById from the JWT user', async () => {
      mockRoomsService.create.mockResolvedValue(mockRoom);
      const dto = { name: 'Room X', type: RoomType.MEETING };

      await controller.createRoom(adminUser, dto);

      expect(mockRoomsService.create).toHaveBeenCalledWith('admin-1', dto);
    });

    it('should create a PRIVATE room with a password', async () => {
      const privateRoom = {
        ...mockRoom,
        accessType: AccessType.PRIVATE,
        name: 'Secret Lab',
      };
      mockRoomsService.create.mockResolvedValue(privateRoom);
      const dto = {
        name: 'Secret Lab',
        type: RoomType.FOCUS,
        accessType: AccessType.PRIVATE,
        password: 'pass1234',
      };

      const result = await controller.createRoom(adminUser, dto);

      expect(result.accessType).toBe(AccessType.PRIVATE);
    });

    it('should propagate ForbiddenException from the guard layer', async () => {
      mockRoomsService.create.mockRejectedValue(new ForbiddenException());

      await expect(
        controller.createRoom(adminUser, { name: 'x', type: RoomType.WORKSPACE }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should propagate NotFoundException when room creation fails', async () => {
      mockRoomsService.create.mockRejectedValue(new NotFoundException());

      await expect(
        controller.createRoom(adminUser, { name: 'x', type: RoomType.WORKSPACE }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
