import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { MessageType } from 'src/generated/prisma/client';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mockRoom = { id: 'room-1', isActive: true };
const mockUser = { id: 'user-1' };
const mockOtherUser = { id: 'user-2' };

const mockMessage = {
  id: 'msg-1',
  content: 'Hello world',
  type: MessageType.TEXT,
  reactions: [],
  isEdited: false,
  isDeleted: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  roomId: 'room-1',
  senderId: 'user-1',
  recipientId: null,
  sender: {
    id: 'user-1',
    username: 'alice',
    firstName: 'Alice',
    lastName: 'Smith',
    profilePicture: null,
    avatarPreset: 'avatar1',
  },
};

const mockDmMessage = {
  ...mockMessage,
  id: 'msg-dm-1',
  roomId: null,
  recipientId: 'user-2',
};

// ── Mock PrismaService ────────────────────────────────────────────────────────

const mockPrisma = {
  room: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  message: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('MessagesService', () => {
  let service: MessagesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── getRoomMessages ───────────────────────────────────────────────────────

  describe('getRoomMessages', () => {
    it('should return messages for a valid active room', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.message.findMany.mockResolvedValue([mockMessage]);

      const result = await service.getRoomMessages('room-1');

      expect(mockPrisma.room.findUnique).toHaveBeenCalledWith({
        where: { id: 'room-1' },
      });
      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ roomId: 'room-1' }),
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should apply cursor filter when cursor is provided', async () => {
      const cursor = new Date().toISOString();
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.message.findMany.mockResolvedValue([]);

      await service.getRoomMessages('room-1', 50, cursor);

      const [call] = mockPrisma.message.findMany.mock.calls as [{ where: { createdAt?: object } }][];
      expect(call[0].where.createdAt).toEqual({ lt: new Date(cursor) });
      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('should throw NotFoundException when room does not exist', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(null);

      await expect(service.getRoomMessages('bad-room')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when room is inactive', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ ...mockRoom, isActive: false });

      await expect(service.getRoomMessages('room-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getDirectMessages ─────────────────────────────────────────────────────

  describe('getDirectMessages', () => {
    it('should return DM thread between two users', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockOtherUser);
      mockPrisma.message.findMany.mockResolvedValue([mockDmMessage]);

      const result = await service.getDirectMessages('user-1', 'user-2');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-2' },
      });
      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            roomId: null,
            OR: [
              { senderId: 'user-1', recipientId: 'user-2' },
              { senderId: 'user-2', recipientId: 'user-1' },
            ],
          }),
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should apply cursor filter when provided', async () => {
      const cursor = new Date().toISOString();
      mockPrisma.user.findUnique.mockResolvedValue(mockOtherUser);
      mockPrisma.message.findMany.mockResolvedValue([]);

      await service.getDirectMessages('user-1', 'user-2', 20, cursor);

      const [call] = mockPrisma.message.findMany.mock.calls as [{ where: { createdAt?: object }; take: number }][];
      expect(call[0].where.createdAt).toEqual({ lt: new Date(cursor) });
      expect(call[0].take).toBe(20);
    });

    it('should throw NotFoundException when other user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.getDirectMessages('user-1', 'ghost-user'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── send ─────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('should send a room message', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.message.create.mockResolvedValue(mockMessage);

      const result = await service.send('user-1', {
        content: 'Hello world',
        roomId: 'room-1',
      });

      expect(mockPrisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            senderId: 'user-1',
            content: 'Hello world',
            roomId: 'room-1',
            recipientId: null,
            type: MessageType.TEXT,
          }),
        }),
      );
      expect(result.content).toBe('Hello world');
    });

    it('should send a direct message', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockOtherUser);
      mockPrisma.message.create.mockResolvedValue(mockDmMessage);

      const result = await service.send('user-1', {
        content: 'Hey!',
        recipientId: 'user-2',
      });

      expect(mockPrisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            senderId: 'user-1',
            recipientId: 'user-2',
            roomId: null,
          }),
        }),
      );
      expect(result.recipientId).toBe('user-2');
    });

    it('should use the provided MessageType', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.message.create.mockResolvedValue({
        ...mockMessage,
        type: MessageType.FILE,
      });

      await service.send('user-1', {
        content: 'See attached',
        roomId: 'room-1',
        type: MessageType.FILE,
      });

      const [call] = mockPrisma.message.create.mock.calls as [{ data: { type: MessageType } }][];
      expect(call[0].data.type).toBe(MessageType.FILE);
    });

    it('should throw BadRequestException when both roomId and recipientId are missing', async () => {
      await expect(
        service.send('user-1', { content: 'oops' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when both roomId and recipientId are set', async () => {
      await expect(
        service.send('user-1', {
          content: 'oops',
          roomId: 'room-1',
          recipientId: 'user-2',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when sender tries to message themselves', async () => {
      await expect(
        service.send('user-1', { content: 'hi me', recipientId: 'user-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when room does not exist', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(null);

      await expect(
        service.send('user-1', { content: 'hi', roomId: 'bad-room' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when room is inactive', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ ...mockRoom, isActive: false });

      await expect(
        service.send('user-1', { content: 'hi', roomId: 'room-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when recipient does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.send('user-1', { content: 'hi', recipientId: 'ghost' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── edit ─────────────────────────────────────────────────────────────────

  describe('edit', () => {
    it('should edit own message and set isEdited to true', async () => {
      mockPrisma.message.findUnique.mockResolvedValue(mockMessage);
      mockPrisma.message.update.mockResolvedValue({
        ...mockMessage,
        content: 'Updated!',
        isEdited: true,
      });

      const result = await service.edit('msg-1', 'user-1', {
        content: 'Updated!',
      });

      expect(mockPrisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-1' },
          data: { content: 'Updated!', isEdited: true },
        }),
      );
      expect(result.isEdited).toBe(true);
      expect(result.content).toBe('Updated!');
    });

    it('should throw NotFoundException when message does not exist', async () => {
      mockPrisma.message.findUnique.mockResolvedValue(null);

      await expect(
        service.edit('bad-id', 'user-1', { content: 'hi' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when caller is not the sender', async () => {
      mockPrisma.message.findUnique.mockResolvedValue(mockMessage);

      await expect(
        service.edit('msg-1', 'user-other', { content: 'hijack' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when message is already deleted', async () => {
      mockPrisma.message.findUnique.mockResolvedValue({
        ...mockMessage,
        isDeleted: true,
      });

      await expect(
        service.edit('msg-1', 'user-1', { content: 'too late' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── softDelete ────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('should soft-delete own message and replace content with [deleted]', async () => {
      mockPrisma.message.findUnique.mockResolvedValue(mockMessage);
      mockPrisma.message.update.mockResolvedValue({
        ...mockMessage,
        isDeleted: true,
        content: '[deleted]',
      });

      const result = await service.softDelete('msg-1', 'user-1');

      expect(mockPrisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-1' },
          data: { isDeleted: true, content: '[deleted]' },
        }),
      );
      expect(result.isDeleted).toBe(true);
      expect(result.content).toBe('[deleted]');
    });

    it('should throw NotFoundException when message does not exist', async () => {
      mockPrisma.message.findUnique.mockResolvedValue(null);

      await expect(service.softDelete('bad-id', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when caller is not the sender', async () => {
      mockPrisma.message.findUnique.mockResolvedValue(mockMessage);

      await expect(service.softDelete('msg-1', 'user-other')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException when message is already deleted', async () => {
      mockPrisma.message.findUnique.mockResolvedValue({
        ...mockMessage,
        isDeleted: true,
      });

      await expect(service.softDelete('msg-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── react ─────────────────────────────────────────────────────────────────

  describe('react', () => {
    it('should add a reaction when user has not reacted yet', async () => {
      mockPrisma.message.findUnique.mockResolvedValue(mockMessage);
      mockPrisma.message.update.mockResolvedValue({
        ...mockMessage,
        reactions: ['👍:user-1'],
      });

      const result = await service.react('msg-1', 'user-1', '👍');

      expect(mockPrisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-1' },
          data: { reactions: ['👍:user-1'] },
        }),
      );
      expect(result.reactions).toContain('👍:user-1');
    });

    it('should remove a reaction when user has already reacted with same emoji', async () => {
      mockPrisma.message.findUnique.mockResolvedValue({
        ...mockMessage,
        reactions: ['👍:user-1', '❤️:user-2'],
      });
      mockPrisma.message.update.mockResolvedValue({
        ...mockMessage,
        reactions: ['❤️:user-2'],
      });

      const result = await service.react('msg-1', 'user-1', '👍');

      expect(mockPrisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { reactions: ['❤️:user-2'] },
        }),
      );
      expect(result.reactions).not.toContain('👍:user-1');
    });

    it('should allow multiple users to react with the same emoji', async () => {
      mockPrisma.message.findUnique.mockResolvedValue({
        ...mockMessage,
        reactions: ['👍:user-1'],
      });
      mockPrisma.message.update.mockResolvedValue({
        ...mockMessage,
        reactions: ['👍:user-1', '👍:user-2'],
      });

      const result = await service.react('msg-1', 'user-2', '👍');

      expect(mockPrisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { reactions: ['👍:user-1', '👍:user-2'] },
        }),
      );
      expect(result.reactions).toHaveLength(2);
    });

    it('should throw NotFoundException when message does not exist', async () => {
      mockPrisma.message.findUnique.mockResolvedValue(null);

      await expect(service.react('bad-id', 'user-1', '👍')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when message is deleted', async () => {
      mockPrisma.message.findUnique.mockResolvedValue({
        ...mockMessage,
        isDeleted: true,
      });

      await expect(service.react('msg-1', 'user-1', '👍')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
