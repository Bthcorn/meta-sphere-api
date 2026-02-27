import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { RoomsService } from './rooms.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { AccessType, RoomType } from 'src/generated/prisma/client';

const mockRoom = {
  id: 'room-uuid-1',
  name: 'Study Hall',
  description: 'A quiet room',
  type: RoomType.FOCUS,
  capacity: 10,
  accessType: AccessType.PUBLIC,
  password: null,
  isActive: true,
  thumbnail: null,
  createdById: 'user-uuid-1',
  userId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrivateRoom = {
  ...mockRoom,
  id: 'room-uuid-2',
  accessType: AccessType.PRIVATE,
  password: '$2b$10$hashedRoomPassword',
};

const mockPrisma = {
  room: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
};

const mockRedis = {
  roomAdd: jest.fn(),
  roomRemove: jest.fn(),
  roomOccupancy: jest.fn(),
  roomUserIds: jest.fn(),
  roomHasUser: jest.fn(),
};

describe('RoomsService', () => {
  let service: RoomsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<RoomsService>(RoomsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── findAllActive ─────────────────────────────────────────────────────

  describe('findAllActive', () => {
    it('should return active rooms with occupancy from Redis', async () => {
      mockPrisma.room.findMany.mockResolvedValue([mockRoom]);
      mockRedis.roomOccupancy.mockResolvedValue(3);

      const result = await service.findAllActive();

      expect(mockPrisma.room.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(result[0].occupancy).toBe(3);
      expect(result[0]).not.toHaveProperty('password');
    });

    it('should return empty array when no active rooms', async () => {
      mockPrisma.room.findMany.mockResolvedValue([]);

      const result = await service.findAllActive();

      expect(result).toEqual([]);
    });
  });

  // ── findById ──────────────────────────────────────────────────────────

  describe('findById', () => {
    it('should return the room with occupancy', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockRedis.roomOccupancy.mockResolvedValue(2);

      const result = await service.findById('room-uuid-1');

      expect(result.id).toBe('room-uuid-1');
      expect(result.occupancy).toBe(2);
      expect(result).not.toHaveProperty('password');
    });

    it('should throw NotFoundException when room does not exist', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when room is inactive', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ ...mockRoom, isActive: false });

      await expect(service.findById('room-uuid-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── joinRoom ──────────────────────────────────────────────────────────

  describe('joinRoom', () => {
    it('should join a public room successfully', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockRedis.roomOccupancy.mockResolvedValue(0);
      mockRedis.roomHasUser.mockResolvedValue(false);
      mockRedis.roomAdd.mockResolvedValue(undefined);

      const result = await service.joinRoom('room-uuid-1', 'user-uuid-1');

      expect(mockRedis.roomAdd).toHaveBeenCalledWith('room-uuid-1', 'user-uuid-1');
      expect(result.message).toBe('Joined room successfully');
    });

    it('should join a private room with the correct password', async () => {
      const hashedPw = await bcrypt.hash('secret', 10);
      mockPrisma.room.findUnique.mockResolvedValue({ ...mockPrivateRoom, password: hashedPw });
      mockRedis.roomOccupancy.mockResolvedValue(0);
      mockRedis.roomHasUser.mockResolvedValue(false);
      mockRedis.roomAdd.mockResolvedValue(undefined);

      const result = await service.joinRoom('room-uuid-2', 'user-uuid-1', 'secret');

      expect(mockRedis.roomAdd).toHaveBeenCalled();
      expect(result.message).toBe('Joined room successfully');
    });

    it('should throw BadRequestException when private room password is missing', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockPrivateRoom);

      await expect(service.joinRoom('room-uuid-2', 'user-uuid-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ForbiddenException on wrong password', async () => {
      const hashedPw = await bcrypt.hash('correct', 10);
      mockPrisma.room.findUnique.mockResolvedValue({ ...mockPrivateRoom, password: hashedPw });

      await expect(
        service.joinRoom('room-uuid-2', 'user-uuid-1', 'wrong'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException when room is at full capacity', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ ...mockRoom, capacity: 2 });
      mockRedis.roomOccupancy.mockResolvedValue(2);
      mockRedis.roomHasUser.mockResolvedValue(false);

      await expect(service.joinRoom('room-uuid-1', 'user-uuid-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should allow re-joining (idempotent) when user is already in the room', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ ...mockRoom, capacity: 1 });
      mockRedis.roomOccupancy.mockResolvedValue(1);
      mockRedis.roomHasUser.mockResolvedValue(true);
      mockRedis.roomAdd.mockResolvedValue(undefined);

      const result = await service.joinRoom('room-uuid-1', 'user-uuid-1');

      expect(result.message).toBe('Joined room successfully');
    });

    it('should throw NotFoundException for an inactive room', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ ...mockRoom, isActive: false });

      await expect(service.joinRoom('room-uuid-1', 'user-uuid-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── leaveRoom ─────────────────────────────────────────────────────────

  describe('leaveRoom', () => {
    it('should remove the user from Redis and return a message', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockRedis.roomRemove.mockResolvedValue(undefined);

      const result = await service.leaveRoom('room-uuid-1', 'user-uuid-1');

      expect(mockRedis.roomRemove).toHaveBeenCalledWith('room-uuid-1', 'user-uuid-1');
      expect(result.message).toBe('Left room successfully');
    });

    it('should throw NotFoundException when room does not exist', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(null);

      await expect(service.leaveRoom('nonexistent', 'user-uuid-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getUsersInRoom ────────────────────────────────────────────────────

  describe('getUsersInRoom', () => {
    it('should return user details for each member in the room', async () => {
      const roomUser = {
        id: 'user-uuid-1',
        username: 'alice',
        firstName: 'Alice',
        lastName: 'Smith',
        profilePicture: null,
        avatarPreset: 'avatar1',
        status: 'AVAILABLE',
      };
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockRedis.roomUserIds.mockResolvedValue(['user-uuid-1']);
      mockPrisma.user.findMany.mockResolvedValue([roomUser]);

      const result = await service.getUsersInRoom('room-uuid-1');

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-uuid-1'] } },
        select: expect.objectContaining({ id: true, username: true }),
      });
      expect(result).toHaveLength(1);
      expect(result[0].username).toBe('alice');
    });

    it('should return an empty array when room is empty', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockRedis.roomUserIds.mockResolvedValue([]);

      const result = await service.getUsersInRoom('room-uuid-1');

      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should throw NotFoundException when room does not exist', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(null);

      await expect(service.getUsersInRoom('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
