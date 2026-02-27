import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessageType, UserRole } from 'src/generated/prisma/client';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const senderUser: JwtUser = { userId: 'user-1', username: 'alice', role: UserRole.USER };
const otherUser: JwtUser = { userId: 'user-2', username: 'bob', role: UserRole.USER };

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

// ── Mock service ──────────────────────────────────────────────────────────────

const mockMessagesService = {
  getRoomMessages: jest.fn(),
  getDirectMessages: jest.fn(),
  send: jest.fn(),
  edit: jest.fn(),
  softDelete: jest.fn(),
  react: jest.fn(),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('MessagesController', () => {
  let controller: MessagesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [{ provide: MessagesService, useValue: mockMessagesService }],
    }).compile();

    controller = module.get<MessagesController>(MessagesController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── GET /messages/room/:roomId ────────────────────────────────────────────

  describe('getRoomMessages', () => {
    it('should call service with roomId and default limit', async () => {
      mockMessagesService.getRoomMessages.mockResolvedValue([mockMessage]);

      const result = await controller.getRoomMessages('room-1');

      expect(mockMessagesService.getRoomMessages).toHaveBeenCalledWith(
        'room-1',
        100,
        undefined,
      );
      expect(result).toHaveLength(1);
    });

    it('should parse and clamp the limit query param', async () => {
      mockMessagesService.getRoomMessages.mockResolvedValue([]);

      await controller.getRoomMessages('room-1', '50');

      expect(mockMessagesService.getRoomMessages).toHaveBeenCalledWith(
        'room-1',
        50,
        undefined,
      );
    });

    it('should clamp limit to 100 when value exceeds maximum', async () => {
      mockMessagesService.getRoomMessages.mockResolvedValue([]);

      await controller.getRoomMessages('room-1', '200');

      expect(mockMessagesService.getRoomMessages).toHaveBeenCalledWith(
        'room-1',
        100,
        undefined,
      );
    });

    it('should forward cursor to service', async () => {
      const cursor = new Date().toISOString();
      mockMessagesService.getRoomMessages.mockResolvedValue([]);

      await controller.getRoomMessages('room-1', undefined, cursor);

      expect(mockMessagesService.getRoomMessages).toHaveBeenCalledWith(
        'room-1',
        100,
        cursor,
      );
    });

    it('should propagate NotFoundException from service', async () => {
      mockMessagesService.getRoomMessages.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(controller.getRoomMessages('bad-room')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── GET /messages/direct/:userId ──────────────────────────────────────────

  describe('getDirectMessages', () => {
    it('should call service with currentUserId and targetUserId', async () => {
      mockMessagesService.getDirectMessages.mockResolvedValue([mockDmMessage]);

      const result = await controller.getDirectMessages(senderUser, 'user-2');

      expect(mockMessagesService.getDirectMessages).toHaveBeenCalledWith(
        'user-1',
        'user-2',
        100,
        undefined,
      );
      expect(result).toHaveLength(1);
    });

    it('should parse limit and forward cursor', async () => {
      const cursor = new Date().toISOString();
      mockMessagesService.getDirectMessages.mockResolvedValue([]);

      await controller.getDirectMessages(senderUser, 'user-2', '25', cursor);

      expect(mockMessagesService.getDirectMessages).toHaveBeenCalledWith(
        'user-1',
        'user-2',
        25,
        cursor,
      );
    });

    it('should propagate NotFoundException when user not found', async () => {
      mockMessagesService.getDirectMessages.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(
        controller.getDirectMessages(senderUser, 'ghost'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── POST /messages ────────────────────────────────────────────────────────

  describe('send', () => {
    it('should send a room message', async () => {
      mockMessagesService.send.mockResolvedValue(mockMessage);

      const result = await controller.send(senderUser, {
        content: 'Hello world',
        roomId: 'room-1',
      });

      expect(mockMessagesService.send).toHaveBeenCalledWith('user-1', {
        content: 'Hello world',
        roomId: 'room-1',
      });
      expect(result.roomId).toBe('room-1');
    });

    it('should send a DM', async () => {
      mockMessagesService.send.mockResolvedValue(mockDmMessage);

      const result = await controller.send(senderUser, {
        content: 'Hey Bob',
        recipientId: 'user-2',
      });

      expect(mockMessagesService.send).toHaveBeenCalledWith('user-1', {
        content: 'Hey Bob',
        recipientId: 'user-2',
      });
      expect(result.recipientId).toBe('user-2');
    });

    it('should propagate BadRequestException from service', async () => {
      mockMessagesService.send.mockRejectedValue(new BadRequestException());

      await expect(
        controller.send(senderUser, { content: 'oops' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate NotFoundException when room not found', async () => {
      mockMessagesService.send.mockRejectedValue(new NotFoundException());

      await expect(
        controller.send(senderUser, { content: 'hi', roomId: 'bad-room' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── PATCH /messages/:id ───────────────────────────────────────────────────

  describe('edit', () => {
    it('should pass id, userId and dto to service', async () => {
      const edited = { ...mockMessage, content: 'Edited!', isEdited: true };
      mockMessagesService.edit.mockResolvedValue(edited);

      const result = await controller.edit(senderUser, 'msg-1', {
        content: 'Edited!',
      });

      expect(mockMessagesService.edit).toHaveBeenCalledWith(
        'msg-1',
        'user-1',
        { content: 'Edited!' },
      );
      expect(result.isEdited).toBe(true);
      expect(result.content).toBe('Edited!');
    });

    it('should propagate ForbiddenException when caller is not sender', async () => {
      mockMessagesService.edit.mockRejectedValue(new ForbiddenException());

      await expect(
        controller.edit(otherUser, 'msg-1', { content: 'hack' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should propagate NotFoundException when message not found', async () => {
      mockMessagesService.edit.mockRejectedValue(new NotFoundException());

      await expect(
        controller.edit(senderUser, 'bad-id', { content: 'hi' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate BadRequestException when message is deleted', async () => {
      mockMessagesService.edit.mockRejectedValue(new BadRequestException());

      await expect(
        controller.edit(senderUser, 'msg-1', { content: 'too late' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── DELETE /messages/:id ──────────────────────────────────────────────────

  describe('softDelete', () => {
    it('should call service with id and userId', async () => {
      const deleted = { ...mockMessage, isDeleted: true, content: '[deleted]' };
      mockMessagesService.softDelete.mockResolvedValue(deleted);

      const result = await controller.softDelete(senderUser, 'msg-1');

      expect(mockMessagesService.softDelete).toHaveBeenCalledWith(
        'msg-1',
        'user-1',
      );
      expect(result.isDeleted).toBe(true);
      expect(result.content).toBe('[deleted]');
    });

    it('should propagate ForbiddenException when caller is not the sender', async () => {
      mockMessagesService.softDelete.mockRejectedValue(new ForbiddenException());

      await expect(
        controller.softDelete(otherUser, 'msg-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should propagate NotFoundException when message not found', async () => {
      mockMessagesService.softDelete.mockRejectedValue(new NotFoundException());

      await expect(
        controller.softDelete(senderUser, 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate BadRequestException when already deleted', async () => {
      mockMessagesService.softDelete.mockRejectedValue(
        new BadRequestException(),
      );

      await expect(
        controller.softDelete(senderUser, 'msg-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── POST /messages/:id/react ──────────────────────────────────────────────

  describe('react', () => {
    it('should add a reaction', async () => {
      const reacted = { ...mockMessage, reactions: ['👍:user-1'] };
      mockMessagesService.react.mockResolvedValue(reacted);

      const result = await controller.react(senderUser, 'msg-1', {
        emoji: '👍',
      });

      expect(mockMessagesService.react).toHaveBeenCalledWith(
        'msg-1',
        'user-1',
        '👍',
      );
      expect(result.reactions).toContain('👍:user-1');
    });

    it('should remove a reaction (toggle off)', async () => {
      const toggled = { ...mockMessage, reactions: [] };
      mockMessagesService.react.mockResolvedValue(toggled);

      const result = await controller.react(senderUser, 'msg-1', {
        emoji: '👍',
      });

      expect(mockMessagesService.react).toHaveBeenCalledWith(
        'msg-1',
        'user-1',
        '👍',
      );
      expect(result.reactions).toHaveLength(0);
    });

    it('should propagate NotFoundException when message not found', async () => {
      mockMessagesService.react.mockRejectedValue(new NotFoundException());

      await expect(
        controller.react(senderUser, 'bad-id', { emoji: '👍' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should propagate BadRequestException when reacting to a deleted message', async () => {
      mockMessagesService.react.mockRejectedValue(new BadRequestException());

      await expect(
        controller.react(senderUser, 'msg-1', { emoji: '👍' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
