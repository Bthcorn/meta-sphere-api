import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class PresenceService {
  private readonly onlineUsers = new Set<string>();

  @OnEvent('user.connected')
  handleUserConnected(payload: { userId: string }): void {
    this.onlineUsers.add(payload.userId);
  }

  @OnEvent('user.disconnected')
  handleUserDisconnected(payload: { userId: string }): void {
    this.onlineUsers.delete(payload.userId);
  }

  isUserOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }

  getOnlineUsers(): string[] {
    return Array.from(this.onlineUsers);
  }
}
