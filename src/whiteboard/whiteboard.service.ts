import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { WhiteboardStrokeDto } from './dto/whiteboard-stroke.dto';

const STROKE_CAP = 500;
const TTL_SECONDS = 60 * 60 * 24; // 24 hours

@Injectable()
export class WhiteboardService {
  constructor(private readonly redis: RedisService) {}

  private key(sessionId: string): string {
    return `whiteboard:${sessionId}`;
  }

  async persistStroke(
    sessionId: string,
    stroke: WhiteboardStrokeDto,
  ): Promise<void> {
    const key = this.key(sessionId);
    await this.redis.rpush(key, JSON.stringify(stroke));
    await this.redis.ltrim(key, -STROKE_CAP, -1);
    await this.redis.expire(key, TTL_SECONDS);
  }

  async getStrokes(sessionId: string): Promise<WhiteboardStrokeDto[]> {
    const raw = await this.redis.lrange(this.key(sessionId), 0, -1);
    return raw.map((r) => JSON.parse(r) as WhiteboardStrokeDto);
  }

  async removeStroke(sessionId: string, strokeId: string): Promise<void> {
    const key = this.key(sessionId);
    const all = await this.redis.lrange(key, 0, -1);

    for (const raw of all) {
      const stroke = JSON.parse(raw) as WhiteboardStrokeDto;
      if (stroke.id === strokeId) {
        await this.redis.lrem(key, 1, raw);
        break;
      }
    }
  }

  async clearBoard(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }
}
