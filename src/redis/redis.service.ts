import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(configService: ConfigService) {
    super(configService.getOrThrow<string>('REDIS_URL'));

    this.on('error', (err) => this.logger.error('Redis error', err));
    this.on('connect', () => this.logger.log('Redis connected'));
  }

  onModuleDestroy() {
    this.disconnect(false);
  }

  // ── Room occupancy helpers (Redis Set per room) ──────────────────────────

  private roomKey(roomId: string) {
    return `room:${roomId}:users`;
  }

  async roomAdd(roomId: string, userId: string): Promise<void> {
    await this.sadd(this.roomKey(roomId), userId);
  }

  async roomRemove(roomId: string, userId: string): Promise<void> {
    await this.srem(this.roomKey(roomId), userId);
  }

  async roomOccupancy(roomId: string): Promise<number> {
    return this.scard(this.roomKey(roomId));
  }

  async roomUserIds(roomId: string): Promise<string[]> {
    return this.smembers(this.roomKey(roomId));
  }

  async roomHasUser(roomId: string, userId: string): Promise<boolean> {
    return (await this.sismember(this.roomKey(roomId), userId)) === 1;
  }
}
