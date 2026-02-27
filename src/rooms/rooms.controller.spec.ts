import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { AccessType, RoomType, UserRole } from 'src/generated/prisma/client';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

const jwtUser: JwtUser = {
  userId: 'user-uuid-1',
  username: 'alice',
  role: UserRole.USER,
};

const mockRoomWithOccupancy = {
  id: 'room-uuid-1',
  name: 'Study Hall',
  description: 'A quiet room',
  type: RoomType.FOCUS,
  capacity: 10,
  accessType: AccessType.PUBLIC,
  isActive: true,
  thumbnail: null,
  createdById: 'user-uuid-1',
  userId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  occupancy: 3,
};

const mockRoomsService = {
  findAllActive: jest.fn(),
  findById: jest.fn(),
  joinRoom: jest.fn(),
  leaveRoom: jest.fn(),
  getUsersInRoom: jest.fn(),
};

describe('RoomsController', () => {
  let controller: RoomsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [{ provide: RoomsService, useValue: mockRoomsService }],
    }).compile();

    controller = module.get<RoomsController>(RoomsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── GET /rooms ────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return all active rooms with occupancy', async () => {
      mockRoomsService.findAllActive.mockResolvedValue([mockRoomWithOccupancy]);

      const result = await controller.findAll();

      expect(mockRoomsService.findAllActive).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0].occupancy).toBe(3);
    });

    it('should return an empty array when there are no rooms', async () => {
      mockRoomsService.findAllActive.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result).toEqual([]);
    });
  });

  // ── GET /rooms/:id ────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return a room by id', async () => {
      mockRoomsService.findById.mockResolvedValue(mockRoomWithOccupancy);

      const result = await controller.findOne('room-uuid-1');

      expect(mockRoomsService.findById).toHaveBeenCalledWith('room-uuid-1');
      expect(result.id).toBe('room-uuid-1');
    });

    it('should propagate NotFoundException from the service', async () => {
      mockRoomsService.findById.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── POST /rooms/:id/join ──────────────────────────────────────────────

  describe('join', () => {
    it('should join a public room without a password', async () => {
      mockRoomsService.joinRoom.mockResolvedValue({
        message: 'Joined room successfully',
      });

      const result = await controller.join('room-uuid-1', jwtUser, {});

      expect(mockRoomsService.joinRoom).toHaveBeenCalledWith(
        'room-uuid-1',
        'user-uuid-1',
        undefined,
      );
      expect(result.message).toBe('Joined room successfully');
    });

    it('should join a private room passing the password', async () => {
      mockRoomsService.joinRoom.mockResolvedValue({
        message: 'Joined room successfully',
      });

      const result = await controller.join('room-uuid-1', jwtUser, {
        password: 'secret',
      });

      expect(mockRoomsService.joinRoom).toHaveBeenCalledWith(
        'room-uuid-1',
        'user-uuid-1',
        'secret',
      );
      expect(result.message).toBe('Joined room successfully');
    });

    it('should propagate errors from the service (e.g. ForbiddenException)', async () => {
      mockRoomsService.joinRoom.mockRejectedValue(new NotFoundException());

      await expect(controller.join('room-uuid-1', jwtUser, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── POST /rooms/:id/leave ─────────────────────────────────────────────

  describe('leave', () => {
    it('should leave a room', async () => {
      mockRoomsService.leaveRoom.mockResolvedValue({
        message: 'Left room successfully',
      });

      const result = await controller.leave('room-uuid-1', jwtUser);

      expect(mockRoomsService.leaveRoom).toHaveBeenCalledWith(
        'room-uuid-1',
        'user-uuid-1',
      );
      expect(result.message).toBe('Left room successfully');
    });

    it('should propagate NotFoundException from the service', async () => {
      mockRoomsService.leaveRoom.mockRejectedValue(new NotFoundException());

      await expect(controller.leave('nonexistent', jwtUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── GET /rooms/:id/users ──────────────────────────────────────────────

  describe('getUsersInRoom', () => {
    it('should return users currently in the room', async () => {
      const users = [
        {
          id: 'user-uuid-1',
          username: 'alice',
          firstName: 'Alice',
          lastName: 'Smith',
          profilePicture: null,
          avatarPreset: 'avatar1',
          status: 'AVAILABLE',
        },
      ];
      mockRoomsService.getUsersInRoom.mockResolvedValue(users);

      const result = await controller.getUsersInRoom('room-uuid-1');

      expect(mockRoomsService.getUsersInRoom).toHaveBeenCalledWith(
        'room-uuid-1',
      );
      expect(result).toHaveLength(1);
      expect(result[0].username).toBe('alice');
    });

    it('should return an empty array when no users are in the room', async () => {
      mockRoomsService.getUsersInRoom.mockResolvedValue([]);

      const result = await controller.getUsersInRoom('room-uuid-1');

      expect(result).toEqual([]);
    });

    it('should propagate NotFoundException from the service', async () => {
      mockRoomsService.getUsersInRoom.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(controller.getUsersInRoom('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
