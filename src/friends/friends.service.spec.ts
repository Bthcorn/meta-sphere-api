import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { FriendsService } from './friends.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { FriendshipStatus } from 'src/generated/prisma/client';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockUserA = {
  id: 'user-a',
  username: 'alice',
  firstName: 'Alice',
  lastName: 'Smith',
  profilePicture: null,
  avatarPreset: 'avatar1',
  status: 'AVAILABLE',
};

const mockUserB = {
  id: 'user-b',
  username: 'bob',
  firstName: 'Bob',
  lastName: 'Jones',
  profilePicture: null,
  avatarPreset: 'avatar2',
  status: 'AVAILABLE',
};

const pendingFriendship = {
  id: 'friendship-1',
  requesterId: 'user-a',
  addresseeId: 'user-b',
  status: FriendshipStatus.PENDING,
  createdAt: new Date(),
  updatedAt: new Date(),
  requester: mockUserA,
  addressee: mockUserB,
};

const acceptedFriendship = {
  ...pendingFriendship,
  status: FriendshipStatus.ACCEPTED,
};

const declinedFriendship = {
  ...pendingFriendship,
  status: FriendshipStatus.DECLINED,
};

// ── Mock PrismaService ────────────────────────────────────────────────────────

const mockPrisma = {
  user: { findUnique: jest.fn() },
  friendship: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('FriendsService', () => {
  let service: FriendsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<FriendsService>(FriendsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── listFriends ───────────────────────────────────────────────────────────

  describe('listFriends', () => {
    it('should return a mapped list of accepted friends', async () => {
      mockPrisma.friendship.findMany.mockResolvedValue([acceptedFriendship]);

      const result = await service.listFriends('user-a');

      expect(mockPrisma.friendship.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: FriendshipStatus.ACCEPTED,
            OR: [{ requesterId: 'user-a' }, { addresseeId: 'user-a' }],
          }),
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].friend.id).toBe('user-b');
      expect(result[0].friendshipId).toBe('friendship-1');
    });

    it('should resolve the correct friend when user is the addressee', async () => {
      const reverseFs = {
        ...acceptedFriendship,
        requesterId: 'user-b',
        addresseeId: 'user-a',
        requester: mockUserB,
        addressee: mockUserA,
      };
      mockPrisma.friendship.findMany.mockResolvedValue([reverseFs]);

      const result = await service.listFriends('user-a');

      expect(result[0].friend.id).toBe('user-b');
    });

    it('should return empty array when user has no accepted friends', async () => {
      mockPrisma.friendship.findMany.mockResolvedValue([]);

      const result = await service.listFriends('user-a');

      expect(result).toEqual([]);
    });
  });

  // ── listPendingRequests ───────────────────────────────────────────────────

  describe('listPendingRequests', () => {
    it('should return pending requests addressed to the user', async () => {
      mockPrisma.friendship.findMany.mockResolvedValue([pendingFriendship]);

      const result = await service.listPendingRequests('user-b');

      expect(mockPrisma.friendship.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            addresseeId: 'user-b',
            status: FriendshipStatus.PENDING,
          },
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should return empty array when no pending requests exist', async () => {
      mockPrisma.friendship.findMany.mockResolvedValue([]);

      const result = await service.listPendingRequests('user-b');

      expect(result).toEqual([]);
    });
  });

  // ── sendRequest ───────────────────────────────────────────────────────────

  describe('sendRequest', () => {
    it('should create a new friend request', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUserB);
      mockPrisma.friendship.findFirst.mockResolvedValue(null);
      mockPrisma.friendship.create.mockResolvedValue(pendingFriendship);

      const result = await service.sendRequest('user-a', 'user-b');

      expect(mockPrisma.friendship.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { requesterId: 'user-a', addresseeId: 'user-b' },
        }),
      );
      expect(result.status).toBe(FriendshipStatus.PENDING);
    });

    it('should re-send a request when a previous one was declined', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUserB);
      mockPrisma.friendship.findFirst.mockResolvedValue(declinedFriendship);
      mockPrisma.friendship.update.mockResolvedValue(pendingFriendship);

      const result = await service.sendRequest('user-a', 'user-b');

      expect(mockPrisma.friendship.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'friendship-1' },
          data: {
            requesterId: 'user-a',
            addresseeId: 'user-b',
            status: FriendshipStatus.PENDING,
          },
        }),
      );
      expect(result.status).toBe(FriendshipStatus.PENDING);
    });

    it('should throw BadRequestException when sending request to yourself', async () => {
      await expect(service.sendRequest('user-a', 'user-a')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when addressee does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.sendRequest('user-a', 'ghost')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when already friends', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUserB);
      mockPrisma.friendship.findFirst.mockResolvedValue(acceptedFriendship);

      await expect(service.sendRequest('user-a', 'user-b')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException when a pending request already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUserB);
      mockPrisma.friendship.findFirst.mockResolvedValue(pendingFriendship);

      await expect(service.sendRequest('user-a', 'user-b')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── acceptRequest ─────────────────────────────────────────────────────────

  describe('acceptRequest', () => {
    it('should accept a pending request addressed to the user', async () => {
      mockPrisma.friendship.findUnique.mockResolvedValue(pendingFriendship);
      mockPrisma.friendship.update.mockResolvedValue(acceptedFriendship);

      const result = await service.acceptRequest('user-b', 'friendship-1');

      expect(mockPrisma.friendship.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'friendship-1' },
          data: { status: FriendshipStatus.ACCEPTED },
        }),
      );
      expect(result.status).toBe(FriendshipStatus.ACCEPTED);
    });

    it('should throw NotFoundException when request does not exist', async () => {
      mockPrisma.friendship.findUnique.mockResolvedValue(null);

      await expect(
        service.acceptRequest('user-b', 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user is not the addressee', async () => {
      mockPrisma.friendship.findUnique.mockResolvedValue(pendingFriendship);

      await expect(
        service.acceptRequest('user-a', 'friendship-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when request is not pending', async () => {
      mockPrisma.friendship.findUnique.mockResolvedValue(acceptedFriendship);

      await expect(
        service.acceptRequest('user-b', 'friendship-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── declineRequest ────────────────────────────────────────────────────────

  describe('declineRequest', () => {
    it('should decline a pending request addressed to the user', async () => {
      mockPrisma.friendship.findUnique.mockResolvedValue(pendingFriendship);
      mockPrisma.friendship.update.mockResolvedValue(declinedFriendship);

      const result = await service.declineRequest('user-b', 'friendship-1');

      expect(mockPrisma.friendship.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'friendship-1' },
          data: { status: FriendshipStatus.DECLINED },
        }),
      );
      expect(result.status).toBe(FriendshipStatus.DECLINED);
    });

    it('should throw NotFoundException when request does not exist', async () => {
      mockPrisma.friendship.findUnique.mockResolvedValue(null);

      await expect(
        service.declineRequest('user-b', 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user is not the addressee', async () => {
      mockPrisma.friendship.findUnique.mockResolvedValue(pendingFriendship);

      await expect(
        service.declineRequest('user-a', 'friendship-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when request is not pending', async () => {
      mockPrisma.friendship.findUnique.mockResolvedValue(declinedFriendship);

      await expect(
        service.declineRequest('user-b', 'friendship-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── removeFriend ──────────────────────────────────────────────────────────

  describe('removeFriend', () => {
    it('should delete an accepted friendship and return a success message', async () => {
      mockPrisma.friendship.findFirst.mockResolvedValue(acceptedFriendship);
      mockPrisma.friendship.delete.mockResolvedValue(acceptedFriendship);

      const result = await service.removeFriend('user-a', 'user-b');

      expect(mockPrisma.friendship.delete).toHaveBeenCalledWith({
        where: { id: 'friendship-1' },
      });
      expect(result).toEqual({ message: 'Friend removed successfully' });
    });

    it('should find friendship regardless of requester/addressee order', async () => {
      mockPrisma.friendship.findFirst.mockResolvedValue(acceptedFriendship);
      mockPrisma.friendship.delete.mockResolvedValue(acceptedFriendship);

      await service.removeFriend('user-b', 'user-a');

      expect(mockPrisma.friendship.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { requesterId: 'user-b', addresseeId: 'user-a' },
              { requesterId: 'user-a', addresseeId: 'user-b' },
            ],
          }),
        }),
      );
    });

    it('should throw NotFoundException when friendship does not exist', async () => {
      mockPrisma.friendship.findFirst.mockResolvedValue(null);

      await expect(service.removeFriend('user-a', 'user-b')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
