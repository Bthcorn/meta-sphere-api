// src/whiteboard/whiteboard.service.spec.ts

import { Test, TestingModule } from '@nestjs/testing';
import { WhiteboardService } from './whiteboard.service';
import { RedisService } from '../redis/redis.service';
import type { WhiteboardStrokeDto } from './dto/whiteboard-stroke.dto';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION_ID = 'session-abc';
const REDIS_KEY = `whiteboard:${SESSION_ID}`;

const makeStroke = (id: string): WhiteboardStrokeDto => ({
  id,
  type: 'pen',
  points: [0, 0, 10, 10],
  color: '#ffffff',
  width: 2,
  userId: 'user-1',
  timestamp: 1700000000000,
});

const strokeA = makeStroke('stroke-a');
const strokeB = makeStroke('stroke-b');
const strokeC = makeStroke('stroke-c');

// ── Mock RedisService ─────────────────────────────────────────────────────────

const mockRedis = {
  rpush: jest.fn(),
  ltrim: jest.fn(),
  expire: jest.fn(),
  lrange: jest.fn(),
  lrem: jest.fn(),
  del: jest.fn(),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('WhiteboardService', () => {
  let service: WhiteboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhiteboardService,
        { provide: RedisService, useValue: mockRedis },
      ],
    }).compile();

    service = module.get<WhiteboardService>(WhiteboardService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── persistStroke ─────────────────────────────────────────────────────────

  describe('persistStroke', () => {
    it('should rpush the serialised stroke to the correct key', async () => {
      mockRedis.rpush.mockResolvedValue(1);
      mockRedis.ltrim.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);

      await service.persistStroke(SESSION_ID, strokeA);

      expect(mockRedis.rpush).toHaveBeenCalledWith(
        REDIS_KEY,
        JSON.stringify(strokeA),
      );
    });

    it('should trim the list to the last 500 strokes after every push', async () => {
      mockRedis.rpush.mockResolvedValue(1);
      mockRedis.ltrim.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);

      await service.persistStroke(SESSION_ID, strokeA);

      expect(mockRedis.ltrim).toHaveBeenCalledWith(REDIS_KEY, -500, -1);
    });

    it('should refresh the TTL to 24 hours after every push', async () => {
      mockRedis.rpush.mockResolvedValue(1);
      mockRedis.ltrim.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);

      await service.persistStroke(SESSION_ID, strokeA);

      expect(mockRedis.expire).toHaveBeenCalledWith(REDIS_KEY, 86400);
    });

    it('should call rpush → ltrim → expire in order', async () => {
      const order: string[] = [];
      mockRedis.rpush.mockImplementation(() => {
        order.push('rpush');
        return Promise.resolve(1);
      });
      mockRedis.ltrim.mockImplementation(() => {
        order.push('ltrim');
        return Promise.resolve('OK');
      });
      mockRedis.expire.mockImplementation(() => {
        order.push('expire');
        return Promise.resolve(1);
      });

      await service.persistStroke(SESSION_ID, strokeA);

      expect(order).toEqual(['rpush', 'ltrim', 'expire']);
    });

    it('should serialise the stroke as JSON — not pass the raw object', async () => {
      mockRedis.rpush.mockResolvedValue(1);
      mockRedis.ltrim.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);

      await service.persistStroke(SESSION_ID, strokeA);

      const pushed = mockRedis.rpush.mock.calls[0][1];
      expect(typeof pushed).toBe('string');
      expect(JSON.parse(pushed)).toEqual(strokeA);
    });
  });

  // ── getStrokes ────────────────────────────────────────────────────────────

  describe('getStrokes', () => {
    it('should return all strokes deserialised from Redis', async () => {
      mockRedis.lrange.mockResolvedValue([
        JSON.stringify(strokeA),
        JSON.stringify(strokeB),
      ]);

      const result = await service.getStrokes(SESSION_ID);

      expect(mockRedis.lrange).toHaveBeenCalledWith(REDIS_KEY, 0, -1);
      expect(result).toEqual([strokeA, strokeB]);
    });

    it('should return an empty array when there are no strokes', async () => {
      mockRedis.lrange.mockResolvedValue([]);

      const result = await service.getStrokes(SESSION_ID);

      expect(result).toEqual([]);
    });

    it('should return stroke objects, not raw JSON strings', async () => {
      mockRedis.lrange.mockResolvedValue([JSON.stringify(strokeA)]);

      const result = await service.getStrokes(SESSION_ID);

      expect(typeof result[0]).toBe('object');
      expect(result[0].id).toBe('stroke-a');
    });

    it('should preserve the original insertion order', async () => {
      mockRedis.lrange.mockResolvedValue([
        JSON.stringify(strokeA),
        JSON.stringify(strokeB),
        JSON.stringify(strokeC),
      ]);

      const result = await service.getStrokes(SESSION_ID);

      expect(result.map((s) => s.id)).toEqual([
        'stroke-a',
        'stroke-b',
        'stroke-c',
      ]);
    });
  });

  // ── removeStroke ──────────────────────────────────────────────────────────

  describe('removeStroke', () => {
    it('should call lrem with the matching serialised stroke', async () => {
      mockRedis.lrange.mockResolvedValue([
        JSON.stringify(strokeA),
        JSON.stringify(strokeB),
      ]);
      mockRedis.lrem.mockResolvedValue(1);

      await service.removeStroke(SESSION_ID, 'stroke-a');

      expect(mockRedis.lrem).toHaveBeenCalledWith(
        REDIS_KEY,
        1,
        JSON.stringify(strokeA),
      );
    });

    it('should not call lrem when the strokeId does not exist in the list', async () => {
      mockRedis.lrange.mockResolvedValue([
        JSON.stringify(strokeA),
        JSON.stringify(strokeB),
      ]);

      await service.removeStroke(SESSION_ID, 'stroke-nonexistent');

      expect(mockRedis.lrem).not.toHaveBeenCalled();
    });

    it('should stop searching after the first match (no duplicate removals)', async () => {
      mockRedis.lrange.mockResolvedValue([
        JSON.stringify(strokeA),
        JSON.stringify(strokeA), // duplicate (edge case)
        JSON.stringify(strokeB),
      ]);
      mockRedis.lrem.mockResolvedValue(1);

      await service.removeStroke(SESSION_ID, 'stroke-a');

      // lrem is called exactly once — the loop breaks after the first hit
      expect(mockRedis.lrem).toHaveBeenCalledTimes(1);
    });

    it('should remove the correct stroke when multiple strokes exist', async () => {
      mockRedis.lrange.mockResolvedValue([
        JSON.stringify(strokeA),
        JSON.stringify(strokeB),
        JSON.stringify(strokeC),
      ]);
      mockRedis.lrem.mockResolvedValue(1);

      await service.removeStroke(SESSION_ID, 'stroke-b');

      expect(mockRedis.lrem).toHaveBeenCalledWith(
        REDIS_KEY,
        1,
        JSON.stringify(strokeB),
      );
    });

    it('should do nothing when the board is empty', async () => {
      mockRedis.lrange.mockResolvedValue([]);

      await service.removeStroke(SESSION_ID, 'stroke-a');

      expect(mockRedis.lrem).not.toHaveBeenCalled();
    });
  });

  // ── clearBoard ────────────────────────────────────────────────────────────

  describe('clearBoard', () => {
    it('should delete the Redis key for the given session', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.clearBoard(SESSION_ID);

      expect(mockRedis.del).toHaveBeenCalledWith(REDIS_KEY);
    });

    it('should only call del — no lrange, lrem, or rpush', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.clearBoard(SESSION_ID);

      expect(mockRedis.lrange).not.toHaveBeenCalled();
      expect(mockRedis.lrem).not.toHaveBeenCalled();
      expect(mockRedis.rpush).not.toHaveBeenCalled();
    });

    it('should not throw when the key does not exist (del returns 0)', async () => {
      mockRedis.del.mockResolvedValue(0); // key didn't exist

      await expect(service.clearBoard(SESSION_ID)).resolves.not.toThrow();
    });
  });

  // ── Redis key format ──────────────────────────────────────────────────────

  describe('Redis key format', () => {
    it('should always use whiteboard:{sessionId} as the key', async () => {
      mockRedis.rpush.mockResolvedValue(1);
      mockRedis.ltrim.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);
      mockRedis.lrange.mockResolvedValue([]);
      mockRedis.del.mockResolvedValue(1);

      await service.persistStroke(SESSION_ID, strokeA);
      await service.getStrokes(SESSION_ID);
      await service.clearBoard(SESSION_ID);

      const allKeyArgs = [
        mockRedis.rpush.mock.calls[0][0],
        mockRedis.lrange.mock.calls[0][0],
        mockRedis.del.mock.calls[0][0],
      ];

      allKeyArgs.forEach((key) => {
        expect(key).toBe(REDIS_KEY);
      });
    });

    it('should scope keys per session — different sessions produce different keys', async () => {
      mockRedis.rpush.mockResolvedValue(1);
      mockRedis.ltrim.mockResolvedValue('OK');
      mockRedis.expire.mockResolvedValue(1);

      await service.persistStroke('session-1', strokeA);
      await service.persistStroke('session-2', strokeB);

      const [key1] = mockRedis.rpush.mock.calls[0];
      const [key2] = mockRedis.rpush.mock.calls[1];

      expect(key1).toBe('whiteboard:session-1');
      expect(key2).toBe('whiteboard:session-2');
      expect(key1).not.toBe(key2);
    });
  });
});
