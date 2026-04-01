import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mockMessage = {
  id: 'msg-1',
  content: 'Hello world',
  type: 'TEXT',
  reactions: {},
  isDeleted: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  roomId: 'room-1',
  sessionId: null,
  sender: { id: 'user-1', username: 'alice', avatarPreset: 'avatar1' },
};

const mockSessionMessage = {
  ...mockMessage,
  id: 'msg-2',
  sessionId: 'session-1',
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  message: {
    findMany: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  },
};

const mockRedis = {
  lpush: jest.fn(),
  ltrim: jest.fn(),
  lrange: jest.fn(),
  del: jest.fn(),
  set: jest.fn(),
  keys: jest.fn(),
  mget: jest.fn(),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('MessagesService', () => {
  let service: MessagesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
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
    it('should query room messages excluding session messages with default limit', async () => {
      mockPrisma.message.findMany.mockResolvedValue([mockMessage]);

      const result = await service.getRoomMessages('room-1');

      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { roomId: 'room-1', sessionId: null, isDeleted: false },
          orderBy: { createdAt: 'asc' },
          take: 50,
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should apply before cursor when provided', async () => {
      const before = '2026-01-01T12:00:00Z';
      mockPrisma.message.findMany.mockResolvedValue([]);

      await service.getRoomMessages('room-1', 20, before);

      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { lt: new Date(before) },
          }),
          take: 20,
        }),
      );
    });

    it('should not include createdAt filter when before is omitted', async () => {
      mockPrisma.message.findMany.mockResolvedValue([]);

      await service.getRoomMessages('room-1');

      const [call] = mockPrisma.message.findMany.mock.calls as [
        { where: Record<string, unknown> },
      ][];
      expect(call[0].where.createdAt).toBeUndefined();
    });
  });

  // ── getSessionMessages ────────────────────────────────────────────────────

  describe('getSessionMessages', () => {
    it('should query session messages with default limit of 100', async () => {
      mockPrisma.message.findMany.mockResolvedValue([mockSessionMessage]);

      const result = await service.getSessionMessages('session-1');

      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: 'session-1', isDeleted: false },
          orderBy: { createdAt: 'asc' },
          take: 100,
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should apply before cursor and custom limit when provided', async () => {
      const before = '2026-01-01T12:00:00Z';
      mockPrisma.message.findMany.mockResolvedValue([]);

      await service.getSessionMessages('session-1', 30, before);

      expect(mockPrisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { lt: new Date(before) },
          }),
          take: 30,
        }),
      );
    });
  });

  // ── createMessage ─────────────────────────────────────────────────────────

  describe('createMessage', () => {
    it('should persist a room message and cache it under the room key', async () => {
      mockPrisma.message.create.mockResolvedValue(mockMessage);
      mockRedis.lpush.mockResolvedValue(1);
      mockRedis.ltrim.mockResolvedValue('OK');

      const result = await service.createMessage({
        content: 'Hello world',
        senderId: 'user-1',
        roomId: 'room-1',
      });

      expect(mockPrisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: 'Hello world',
            senderId: 'user-1',
            roomId: 'room-1',
            sessionId: null,
          }),
        }),
      );
      expect(mockRedis.lpush).toHaveBeenCalledWith(
        'chat:room:room-1',
        JSON.stringify(mockMessage),
      );
      expect(mockRedis.ltrim).toHaveBeenCalledWith('chat:room:room-1', 0, 99);
      expect(result).toEqual(mockMessage);
    });

    it('should cache under the session key when sessionId is provided', async () => {
      mockPrisma.message.create.mockResolvedValue(mockSessionMessage);
      mockRedis.lpush.mockResolvedValue(1);
      mockRedis.ltrim.mockResolvedValue('OK');

      await service.createMessage({
        content: 'Hello',
        senderId: 'user-1',
        roomId: 'room-1',
        sessionId: 'session-1',
      });

      expect(mockRedis.lpush).toHaveBeenCalledWith(
        'chat:session:session-1',
        expect.any(String),
      );
      expect(mockRedis.ltrim).toHaveBeenCalledWith(
        'chat:session:session-1',
        0,
        99,
      );
    });
  });

  // ── softDelete ────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('should call updateMany scoped to id and senderId', async () => {
      mockPrisma.message.updateMany.mockResolvedValue({ count: 1 });

      await service.softDelete('msg-1', 'user-1');

      expect(mockPrisma.message.updateMany).toHaveBeenCalledWith({
        where: { id: 'msg-1', senderId: 'user-1' },
        data: { isDeleted: true },
      });
    });

    it('should return count 0 when message is not found or not owned', async () => {
      mockPrisma.message.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.softDelete('msg-1', 'other-user');

      expect(result).toEqual({ count: 0 });
    });
  });

  // ── toggleReaction ────────────────────────────────────────────────────────

  describe('toggleReaction', () => {
    it('should add a reaction when user has not reacted yet', async () => {
      mockPrisma.message.findUniqueOrThrow.mockResolvedValue({
        reactions: {},
        roomId: 'room-1',
        sessionId: null,
      });
      mockPrisma.message.update.mockResolvedValue({
        ...mockMessage,
        reactions: { '👍': ['user-1'] },
      });

      const result = await service.toggleReaction('msg-1', 'user-1', '👍');

      expect(mockPrisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'msg-1' },
          data: { reactions: { '👍': ['user-1'] } },
        }),
      );
      expect(result.reactions).toEqual({ '👍': ['user-1'] });
    });

    it('should remove a user from the emoji list when already reacted', async () => {
      mockPrisma.message.findUniqueOrThrow.mockResolvedValue({
        reactions: { '👍': ['user-1', 'user-2'] },
        roomId: 'room-1',
        sessionId: null,
      });
      mockPrisma.message.update.mockResolvedValue({
        ...mockMessage,
        reactions: { '👍': ['user-2'] },
      });

      await service.toggleReaction('msg-1', 'user-1', '👍');

      expect(mockPrisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { reactions: { '👍': ['user-2'] } },
        }),
      );
    });

    it('should delete the emoji key entirely when the last reactor removes their reaction', async () => {
      mockPrisma.message.findUniqueOrThrow.mockResolvedValue({
        reactions: { '👍': ['user-1'] },
        roomId: 'room-1',
        sessionId: null,
      });
      mockPrisma.message.update.mockResolvedValue({
        ...mockMessage,
        reactions: {},
      });

      await service.toggleReaction('msg-1', 'user-1', '👍');

      const [call] = mockPrisma.message.update.mock.calls as [
        { data: { reactions: Record<string, string[]> } },
      ][];
      expect(call[0].data.reactions['👍']).toBeUndefined();
    });

    it('should propagate error when message is not found', async () => {
      mockPrisma.message.findUniqueOrThrow.mockRejectedValue(
        new Error('Record not found'),
      );

      await expect(
        service.toggleReaction('bad-id', 'user-1', '👍'),
      ).rejects.toThrow('Record not found');
    });
  });

  // ── getCachedRoomMessages ─────────────────────────────────────────────────

  describe('getCachedRoomMessages', () => {
    it('should return parsed and reversed messages from Redis', async () => {
      const msgs = [mockMessage, { ...mockMessage, id: 'msg-2' }];
      mockRedis.lrange.mockResolvedValue(msgs.map((m) => JSON.stringify(m)));

      const result = await service.getCachedRoomMessages('room-1');

      expect(mockRedis.lrange).toHaveBeenCalledWith('chat:room:room-1', 0, 99);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('msg-2'); // reversed order
    });

    it('should return empty array when cache is empty', async () => {
      mockRedis.lrange.mockResolvedValue([]);

      const result = await service.getCachedRoomMessages('room-1');

      expect(result).toEqual([]);
    });
  });

  // ── getCachedSessionMessages ──────────────────────────────────────────────

  describe('getCachedSessionMessages', () => {
    it('should return parsed and reversed messages from Redis', async () => {
      mockRedis.lrange.mockResolvedValue([JSON.stringify(mockSessionMessage)]);

      const result = await service.getCachedSessionMessages('session-1');

      expect(mockRedis.lrange).toHaveBeenCalledWith(
        'chat:session:session-1',
        0,
        99,
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg-2');
    });
  });

  // ── clearSessionCache ─────────────────────────────────────────────────────

  describe('clearSessionCache', () => {
    it('should delete the session cache key from Redis', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.clearSessionCache('session-1');

      expect(mockRedis.del).toHaveBeenCalledWith('chat:session:session-1');
    });
  });

  // ── setTyping ─────────────────────────────────────────────────────────────

  describe('setTyping', () => {
    it('should set the typing key with a 4s TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await service.setTyping('room:room-1', 'user-1', 'alice');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'typing:room:room-1:user-1',
        'alice',
        'EX',
        4,
      );
    });
  });

  // ── clearTyping ───────────────────────────────────────────────────────────

  describe('clearTyping', () => {
    it('should delete the typing key for the user', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.clearTyping('room:room-1', 'user-1');

      expect(mockRedis.del).toHaveBeenCalledWith('typing:room:room-1:user-1');
    });
  });

  // ── getTypingUsers ────────────────────────────────────────────────────────

  describe('getTypingUsers', () => {
    it('should return list of typing users with their usernames', async () => {
      mockRedis.keys.mockResolvedValue([
        'typing:room:room-1:user-1',
        'typing:room:room-1:user-2',
      ]);
      mockRedis.mget.mockResolvedValue(['alice', 'bob']);

      const result = await service.getTypingUsers('room:room-1');

      expect(mockRedis.keys).toHaveBeenCalledWith('typing:room:room-1:*');
      expect(result).toEqual([
        { userId: 'user-1', username: 'alice' },
        { userId: 'user-2', username: 'bob' },
      ]);
    });

    it('should return empty array and skip mget when no one is typing', async () => {
      mockRedis.keys.mockResolvedValue([]);

      const result = await service.getTypingUsers('room:room-1');

      expect(result).toEqual([]);
      expect(mockRedis.mget).not.toHaveBeenCalled();
    });

    it('should fall back to "Unknown" when a username value is null', async () => {
      mockRedis.keys.mockResolvedValue(['typing:room:room-1:user-1']);
      mockRedis.mget.mockResolvedValue([null]);

      const result = await service.getTypingUsers('room:room-1');

      expect(result[0].username).toBe('Unknown');
    });
  });
});
