import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FriendshipStatus } from 'src/generated/prisma/client';

const USER_SUMMARY_SELECT = {
  id: true,
  username: true,
  firstName: true,
  lastName: true,
  profilePicture: true,
  avatarPreset: true,
  status: true,
} as const;

const FRIENDSHIP_SELECT = {
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  requesterId: true,
  addresseeId: true,
  requester: { select: USER_SUMMARY_SELECT },
  addressee: { select: USER_SUMMARY_SELECT },
} as const;

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  async listFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: FRIENDSHIP_SELECT,
      orderBy: { updatedAt: 'desc' },
    });

    return friendships.map((f) => ({
      friendshipId: f.id,
      since: f.updatedAt,
      friend: f.requesterId === userId ? f.addressee : f.requester,
    }));
  }

  async listPendingRequests(userId: string) {
    return this.prisma.friendship.findMany({
      where: {
        addresseeId: userId,
        status: FriendshipStatus.PENDING,
      },
      select: FRIENDSHIP_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async sendRequest(requesterId: string, addresseeId: string) {
    if (requesterId === addresseeId) {
      throw new BadRequestException('Cannot send a friend request to yourself');
    }

    const addressee = await this.prisma.user.findUnique({
      where: { id: addresseeId },
    });
    if (!addressee) throw new NotFoundException('User not found');

    const existing = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
      },
    });

    if (existing) {
      if (existing.status === FriendshipStatus.ACCEPTED) {
        throw new ConflictException('You are already friends with this user');
      }
      if (existing.status === FriendshipStatus.PENDING) {
        throw new ConflictException(
          'A friend request already exists between these users',
        );
      }
      if (existing.status === FriendshipStatus.DECLINED) {
        return this.prisma.friendship.update({
          where: { id: existing.id },
          data: {
            requesterId,
            addresseeId,
            status: FriendshipStatus.PENDING,
          },
          select: FRIENDSHIP_SELECT,
        });
      }
    }

    return this.prisma.friendship.create({
      data: { requesterId, addresseeId },
      select: FRIENDSHIP_SELECT,
    });
  }

  async acceptRequest(userId: string, requestId: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id: requestId },
    });
    if (!friendship) throw new NotFoundException('Friend request not found');
    if (friendship.addresseeId !== userId) {
      throw new ForbiddenException(
        'You can only accept requests sent to you',
      );
    }
    if (friendship.status !== FriendshipStatus.PENDING) {
      throw new BadRequestException(
        'This request is no longer pending',
      );
    }

    return this.prisma.friendship.update({
      where: { id: requestId },
      data: { status: FriendshipStatus.ACCEPTED },
      select: FRIENDSHIP_SELECT,
    });
  }

  async declineRequest(userId: string, requestId: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id: requestId },
    });
    if (!friendship) throw new NotFoundException('Friend request not found');
    if (friendship.addresseeId !== userId) {
      throw new ForbiddenException(
        'You can only decline requests sent to you',
      );
    }
    if (friendship.status !== FriendshipStatus.PENDING) {
      throw new BadRequestException(
        'This request is no longer pending',
      );
    }

    return this.prisma.friendship.update({
      where: { id: requestId },
      data: { status: FriendshipStatus.DECLINED },
      select: FRIENDSHIP_SELECT,
    });
  }

  async removeFriend(userId: string, friendUserId: string) {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: userId, addresseeId: friendUserId },
          { requesterId: friendUserId, addresseeId: userId },
        ],
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friendship not found');
    }

    await this.prisma.friendship.delete({ where: { id: friendship.id } });
    return { message: 'Friend removed successfully' };
  }
}
