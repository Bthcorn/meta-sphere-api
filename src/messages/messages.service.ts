import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const MSG_SELECT = {
  id: true,
  content: true,
  type: true,
  reactions: true,
  isDeleted: true,
  createdAt: true,
  roomId: true,
  sessionId: true,
  sender: {
    select: { id: true, username: true, avatarPreset: true },
  },
};

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ── Room messages (Chilling, Library) ──────────────────────────────────────
  async getRoomMessages(roomId: string, limit = 50, before?: string) {
    return this.prisma.message.findMany({
      where: {
        roomId,
        sessionId: null, // room-only, never session messages
        isDeleted: false,
        ...(before && { createdAt: { lt: new Date(before) } }),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: MSG_SELECT,
    });
  }

  // ── Session messages (Meeting, Lecture) ────────────────────────────────────
  async getSessionMessages(sessionId: string, limit = 100, before?: string) {
    return this.prisma.message.findMany({
      where: {
        sessionId,
        isDeleted: false,
        ...(before && { createdAt: { lt: new Date(before) } }),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: MSG_SELECT,
    });
  }

  // ── Persist a new message ──────────────────────────────────────────────────
  async createMessage(data: {
    content: string;
    senderId: string;
    roomId: string;
    sessionId?: string;
  }) {
    const message = await this.prisma.message.create({
      data: {
        content: data.content,
        senderId: data.senderId,
        roomId: data.roomId,
        sessionId: data.sessionId ?? null,
      },
      select: MSG_SELECT,
    });

    // Cache in Redis for fast replay on join
    const cacheKey = data.sessionId
      ? `chat:session:${data.sessionId}`
      : `chat:room:${data.roomId}`;

    await this.redis.lpush(cacheKey, JSON.stringify(message));
    await this.redis.ltrim(cacheKey, 0, 99); // keep last 100

    return message;
  }

  // ── Soft-delete ────────────────────────────────────────────────────────────
  async softDelete(messageId: string, requesterId: string) {
    return this.prisma.message.updateMany({
      where: { id: messageId, senderId: requesterId },
      data: { isDeleted: true },
    });
  }

  // ── Add / toggle reaction ──────────────────────────────────────────────────
  async toggleReaction(messageId: string, userId: string, emoji: string) {
    const message = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      select: { reactions: true, roomId: true, sessionId: true },
    });

    const reactions = (message.reactions ?? {}) as unknown as Record<
      string,
      string[]
    >;
    const current = reactions[emoji] ?? [];
    reactions[emoji] = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];

    // Clean up empty emoji keys
    if (reactions[emoji].length === 0) delete reactions[emoji];

    return this.prisma.message.update({
      where: { id: messageId },
      data: { reactions },
      select: MSG_SELECT,
    });
  }

  // ── Redis cache helpers ────────────────────────────────────────────────────
  async getCachedRoomMessages(roomId: string) {
    const raw = await this.redis.lrange(`chat:room:${roomId}`, 0, 99);
    return raw.reverse().map((s) => JSON.parse(s));
  }

  async getCachedSessionMessages(sessionId: string) {
    const raw = await this.redis.lrange(`chat:session:${sessionId}`, 0, 99);
    return raw.reverse().map((s) => JSON.parse(s));
  }

  async clearSessionCache(sessionId: string) {
    await this.redis.del(`chat:session:${sessionId}`);
  }

  // ── Typing state via Redis TTL ─────────────────────────────────────────────
  async setTyping(scope: string, userId: string, username: string) {
    // scope = "room:{roomId}" or "session:{sessionId}"
    await this.redis.set(
      `typing:${scope}:${userId}`,
      username,
      'EX',
      4, // auto-expires in 4 s — no stale indicators
    );
  }

  async clearTyping(scope: string, userId: string) {
    await this.redis.del(`typing:${scope}:${userId}`);
  }

  async getTypingUsers(
    scope: string,
  ): Promise<{ userId: string; username: string }[]> {
    const keys = await this.redis.keys(`typing:${scope}:*`);
    if (!keys.length) return [];
    const names = await this.redis.mget(...keys);
    return keys.map((key, i) => ({
      userId: key.split(':').pop()!,
      username: names[i] ?? 'Unknown',
    }));
  }
}
