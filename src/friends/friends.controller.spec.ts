import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { FriendshipStatus } from 'src/generated/prisma/client';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockUser: JwtUser = { userId: 'user-a', username: 'alice', role: 'USER' };

const mockFriendEntry = {
  friendshipId: 'friendship-1',
  since: new Date(),
  friend: {
    id: 'user-b',
    username: 'bob',
    firstName: 'Bob',
    lastName: 'Jones',
    profilePicture: null,
    avatarPreset: 'avatar2',
    status: 'AVAILABLE',
  },
};

const mockFriendship = {
  id: 'friendship-1',
  requesterId: 'user-a',
  addresseeId: 'user-b',
  status: FriendshipStatus.PENDING,
  createdAt: new Date(),
  updatedAt: new Date(),
  requester: { id: 'user-a', username: 'alice' },
  addressee: { id: 'user-b', username: 'bob' },
};

// ── Mock FriendsService ───────────────────────────────────────────────────────

const mockService = {
  listFriends: jest.fn(),
  listPendingRequests: jest.fn(),
  sendRequest: jest.fn(),
  acceptRequest: jest.fn(),
  declineRequest: jest.fn(),
  removeFriend: jest.fn(),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('FriendsController', () => {
  let controller: FriendsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FriendsController],
      providers: [{ provide: FriendsService, useValue: mockService }],
    }).compile();

    controller = module.get<FriendsController>(FriendsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── GET /friends ──────────────────────────────────────────────────────────

  describe('listFriends', () => {
    it('should return accepted friends for the current user', async () => {
      mockService.listFriends.mockResolvedValue([mockFriendEntry]);

      const result = await controller.listFriends(mockUser);

      expect(mockService.listFriends).toHaveBeenCalledWith('user-a');
      expect(result).toHaveLength(1);
      expect(result[0].friend.id).toBe('user-b');
    });

    it('should return an empty array when user has no friends', async () => {
      mockService.listFriends.mockResolvedValue([]);

      const result = await controller.listFriends(mockUser);

      expect(result).toEqual([]);
    });
  });

  // ── GET /friends/requests ─────────────────────────────────────────────────

  describe('listPendingRequests', () => {
    it('should return pending requests for the current user', async () => {
      mockService.listPendingRequests.mockResolvedValue([mockFriendship]);

      const result = await controller.listPendingRequests(mockUser);

      expect(mockService.listPendingRequests).toHaveBeenCalledWith('user-a');
      expect(result).toHaveLength(1);
    });

    it('should return empty array when no pending requests', async () => {
      mockService.listPendingRequests.mockResolvedValue([]);

      const result = await controller.listPendingRequests(mockUser);

      expect(result).toEqual([]);
    });
  });

  // ── POST /friends/request/:userId ─────────────────────────────────────────

  describe('sendRequest', () => {
    it('should send a friend request to a target user', async () => {
      mockService.sendRequest.mockResolvedValue(mockFriendship);

      const result = await controller.sendRequest(mockUser, 'user-b');

      expect(mockService.sendRequest).toHaveBeenCalledWith('user-a', 'user-b');
      expect(result.status).toBe(FriendshipStatus.PENDING);
    });

    it('should propagate BadRequestException when sending request to yourself', async () => {
      mockService.sendRequest.mockRejectedValue(
        new BadRequestException('Cannot send a friend request to yourself'),
      );

      await expect(controller.sendRequest(mockUser, 'user-a')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should propagate NotFoundException when target user does not exist', async () => {
      mockService.sendRequest.mockRejectedValue(
        new NotFoundException('User not found'),
      );

      await expect(
        controller.sendRequest(mockUser, 'ghost-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate ConflictException when already friends', async () => {
      mockService.sendRequest.mockRejectedValue(
        new ConflictException('You are already friends with this user'),
      );

      await expect(controller.sendRequest(mockUser, 'user-b')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── POST /friends/accept/:requestId ──────────────────────────────────────

  describe('acceptRequest', () => {
    it('should accept a friend request', async () => {
      const accepted = { ...mockFriendship, status: FriendshipStatus.ACCEPTED };
      mockService.acceptRequest.mockResolvedValue(accepted);

      const result = await controller.acceptRequest(mockUser, 'friendship-1');

      expect(mockService.acceptRequest).toHaveBeenCalledWith(
        'user-a',
        'friendship-1',
      );
      expect(result.status).toBe(FriendshipStatus.ACCEPTED);
    });

    it('should propagate NotFoundException when request does not exist', async () => {
      mockService.acceptRequest.mockRejectedValue(
        new NotFoundException('Friend request not found'),
      );

      await expect(
        controller.acceptRequest(mockUser, 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate ForbiddenException when user is not the addressee', async () => {
      mockService.acceptRequest.mockRejectedValue(
        new ForbiddenException('You can only accept requests sent to you'),
      );

      await expect(
        controller.acceptRequest(mockUser, 'friendship-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should propagate BadRequestException when request is not pending', async () => {
      mockService.acceptRequest.mockRejectedValue(
        new BadRequestException('This request is no longer pending'),
      );

      await expect(
        controller.acceptRequest(mockUser, 'friendship-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── POST /friends/decline/:requestId ─────────────────────────────────────

  describe('declineRequest', () => {
    it('should decline a friend request', async () => {
      const declined = { ...mockFriendship, status: FriendshipStatus.DECLINED };
      mockService.declineRequest.mockResolvedValue(declined);

      const result = await controller.declineRequest(mockUser, 'friendship-1');

      expect(mockService.declineRequest).toHaveBeenCalledWith(
        'user-a',
        'friendship-1',
      );
      expect(result.status).toBe(FriendshipStatus.DECLINED);
    });

    it('should propagate NotFoundException when request does not exist', async () => {
      mockService.declineRequest.mockRejectedValue(
        new NotFoundException('Friend request not found'),
      );

      await expect(
        controller.declineRequest(mockUser, 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate ForbiddenException when user is not the addressee', async () => {
      mockService.declineRequest.mockRejectedValue(
        new ForbiddenException('You can only decline requests sent to you'),
      );

      await expect(
        controller.declineRequest(mockUser, 'friendship-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should propagate BadRequestException when request is not pending', async () => {
      mockService.declineRequest.mockRejectedValue(
        new BadRequestException('This request is no longer pending'),
      );

      await expect(
        controller.declineRequest(mockUser, 'friendship-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── DELETE /friends/:userId ───────────────────────────────────────────────

  describe('removeFriend', () => {
    it('should remove a friend and return a success message', async () => {
      mockService.removeFriend.mockResolvedValue({
        message: 'Friend removed successfully',
      });

      const result = await controller.removeFriend(mockUser, 'user-b');

      expect(mockService.removeFriend).toHaveBeenCalledWith('user-a', 'user-b');
      expect(result).toEqual({ message: 'Friend removed successfully' });
    });

    it('should propagate NotFoundException when friendship does not exist', async () => {
      mockService.removeFriend.mockRejectedValue(
        new NotFoundException('Friendship not found'),
      );

      await expect(controller.removeFriend(mockUser, 'user-b')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
