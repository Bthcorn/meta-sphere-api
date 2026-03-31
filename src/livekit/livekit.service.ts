import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

@Injectable()
export class LiveKitService implements OnModuleInit {
  private readonly logger = new Logger(LiveKitService.name);
  private roomService: RoomServiceClient;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.getOrThrow<string>('LIVEKIT_URL');
    const apiKey = this.configService.getOrThrow<string>('LIVEKIT_API_KEY');
    const secret = this.configService.getOrThrow<string>('LIVEKIT_API_SECRET');

    this.roomService = new RoomServiceClient(url, apiKey, secret);
  }

  getLiveKitUrl(): string {
    return this.configService.getOrThrow<string>('LIVEKIT_URL');
  }

  async createToken(
    userId: string,
    name: string | null,
    sessionId: string,
    isHost: boolean = false,
  ): Promise<string> {
    const apiKey = this.configService.getOrThrow<string>('LIVEKIT_API_KEY');
    const secret = this.configService.getOrThrow<string>('LIVEKIT_API_SECRET');

    const at = new AccessToken(apiKey, secret, {
      identity: userId,
      name: name ?? userId,
    });

    at.addGrant({
      roomJoin: true,
      room: sessionId,
      canPublish: true,
      canSubscribe: true,
      roomAdmin: isHost,
    });

    return at.toJwt();
  }

  async deleteRoom(sessionId: string): Promise<void> {
    try {
      await this.roomService.deleteRoom(sessionId);
      this.logger.log(`LiveKit room ${sessionId} deleted`);
    } catch (e: unknown) {
      if ((e as any)?.response?.status !== 404 && (e as any)?.status !== 404) {
        this.logger.error(
          `Failed to delete room ${sessionId}: ${(e as Error).message}`,
          (e as Error).stack,
        );
      }
    }
  }
}
