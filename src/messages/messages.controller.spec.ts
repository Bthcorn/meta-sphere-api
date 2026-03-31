import { Test, TestingModule } from '@nestjs/testing';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { GetMessagesDto } from './dto/get-messages.dto';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mockMessage = {
  id: 'msg-1',
  content: 'Hello world',
  type: 'TEXT',
  reactions: {},
  isDeleted: false,
  createdAt: new Date(),
  roomId: 'room-1',
  sessionId: null,
  sender: { id: 'user-1', username: 'alice', avatarPreset: 'avatar1' },
};

const mockSessionMessage = {
  ...mockMessage,
  id: 'msg-2',
  sessionId: 'session-1',
};

// ── Mock service ──────────────────────────────────────────────────────────────

const mockMessagesService = {
  getRoomMessages: jest.fn(),
  getSessionMessages: jest.fn(),
  softDelete: jest.fn(),
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
    it('should forward roomId, limit and before to service', async () => {
      mockMessagesService.getRoomMessages.mockResolvedValue([mockMessage]);
      const query: GetMessagesDto = { limit: 50, before: undefined };

      const result = await controller.getRoomMessages('room-1', query);

      expect(mockMessagesService.getRoomMessages).toHaveBeenCalledWith(
        'room-1',
        50,
        undefined,
      );
      expect(result).toHaveLength(1);
    });

    it('should forward before cursor to service when provided', async () => {
      const before = '2026-01-01T12:00:00Z';
      mockMessagesService.getRoomMessages.mockResolvedValue([]);
      const query: GetMessagesDto = { limit: 20, before };

      await controller.getRoomMessages('room-1', query);

      expect(mockMessagesService.getRoomMessages).toHaveBeenCalledWith(
        'room-1',
        20,
        before,
      );
    });

    it('should propagate errors from service', async () => {
      mockMessagesService.getRoomMessages.mockRejectedValue(new Error('fail'));

      await expect(
        controller.getRoomMessages('room-1', { limit: 50 }),
      ).rejects.toThrow('fail');
    });
  });

  // ── GET /messages/session/:sessionId ─────────────────────────────────────

  describe('getSessionMessages', () => {
    it('should forward sessionId, limit and before to service', async () => {
      mockMessagesService.getSessionMessages.mockResolvedValue([
        mockSessionMessage,
      ]);
      const query: GetMessagesDto = { limit: 100, before: undefined };

      const result = await controller.getSessionMessages('session-1', query);

      expect(mockMessagesService.getSessionMessages).toHaveBeenCalledWith(
        'session-1',
        100,
        undefined,
      );
      expect(result).toHaveLength(1);
    });

    it('should forward before cursor to service when provided', async () => {
      const before = '2026-01-01T12:00:00Z';
      mockMessagesService.getSessionMessages.mockResolvedValue([]);
      const query: GetMessagesDto = { limit: 50, before };

      await controller.getSessionMessages('session-1', query);

      expect(mockMessagesService.getSessionMessages).toHaveBeenCalledWith(
        'session-1',
        50,
        before,
      );
    });
  });

  // ── DELETE /messages/:id ──────────────────────────────────────────────────

  describe('deleteMessage', () => {
    it('should call softDelete with message id and user sub from request', async () => {
      mockMessagesService.softDelete.mockResolvedValue({ count: 1 });
      const req = { user: { sub: 'user-1' } };

      const result = await controller.deleteMessage('msg-1', req);

      expect(mockMessagesService.softDelete).toHaveBeenCalledWith(
        'msg-1',
        'user-1',
      );
      expect(result).toEqual({ count: 1 });
    });

    it('should return count 0 when message is not owned by the requester', async () => {
      mockMessagesService.softDelete.mockResolvedValue({ count: 0 });
      const req = { user: { sub: 'other-user' } };

      const result = await controller.deleteMessage('msg-1', req);

      expect(result).toEqual({ count: 0 });
    });
  });
});
