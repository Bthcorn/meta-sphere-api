import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MessageType } from 'src/generated/prisma/client';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';

const MESSAGE_SELECT = {
  id: true,
  content: true,
  type: true,
  reactions: true,
  isEdited: true,
  isDeleted: true,
  createdAt: true,
  updatedAt: true,
  roomId: true,
  senderId: true,
  recipientId: true,
  sender: {
    select: {
      id: true,
      username: true,
      firstName: true,
      lastName: true,
      profilePicture: true,
      avatarPreset: true,
    },
  },
} as const;

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async getRoomMessages(roomId: string, limit = 100, cursor?: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room || !room.isActive) throw new NotFoundException('Room not found');

    return this.prisma.message.findMany({
      where: {
        roomId,
        ...(cursor && { createdAt: { lt: new Date(cursor) } }),
      },
      select: MESSAGE_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getDirectMessages(
    currentUserId: string,
    otherUserId: string,
    limit = 100,
    cursor?: string,
  ) {
    const otherUser = await this.prisma.user.findUnique({
      where: { id: otherUserId },
    });
    if (!otherUser) throw new NotFoundException('User not found');

    return this.prisma.message.findMany({
      where: {
        roomId: null,
        OR: [
          { senderId: currentUserId, recipientId: otherUserId },
          { senderId: otherUserId, recipientId: currentUserId },
        ],
        ...(cursor && { createdAt: { lt: new Date(cursor) } }),
      },
      select: MESSAGE_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async send(senderId: string, dto: CreateMessageDto) {
    if (!dto.roomId && !dto.recipientId) {
      throw new BadRequestException(
        'Either roomId or recipientId must be provided',
      );
    }
    if (dto.roomId && dto.recipientId) {
      throw new BadRequestException(
        'Provide either roomId or recipientId, not both',
      );
    }

    if (dto.roomId) {
      const room = await this.prisma.room.findUnique({
        where: { id: dto.roomId },
      });
      if (!room || !room.isActive) throw new NotFoundException('Room not found');
    }

    if (dto.recipientId) {
      if (dto.recipientId === senderId) {
        throw new BadRequestException('Cannot send a message to yourself');
      }
      const recipient = await this.prisma.user.findUnique({
        where: { id: dto.recipientId },
      });
      if (!recipient) throw new NotFoundException('Recipient not found');
    }

    return this.prisma.message.create({
      data: {
        senderId,
        content: dto.content,
        type: dto.type ?? MessageType.TEXT,
        roomId: dto.roomId ?? null,
        recipientId: dto.recipientId ?? null,
      },
      select: MESSAGE_SELECT,
    });
  }

  async edit(messageId: string, userId: string, dto: UpdateMessageDto) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }
    if (message.isDeleted) {
      throw new BadRequestException('Cannot edit a deleted message');
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: { content: dto.content, isEdited: true },
      select: MESSAGE_SELECT,
    });
  }

  async softDelete(messageId: string, userId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }
    if (message.isDeleted) {
      throw new BadRequestException('Message is already deleted');
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: { isDeleted: true, content: '[deleted]' },
      select: MESSAGE_SELECT,
    });
  }

  async react(messageId: string, userId: string, emoji: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.isDeleted) {
      throw new BadRequestException('Cannot react to a deleted message');
    }

    const entry = `${emoji}:${userId}`;
    const hasReacted = message.reactions.includes(entry);
    const updatedReactions = hasReacted
      ? message.reactions.filter((r) => r !== entry)
      : [...message.reactions, entry];

    return this.prisma.message.update({
      where: { id: messageId },
      data: { reactions: updatedReactions },
      select: MESSAGE_SELECT,
    });
  }
}
