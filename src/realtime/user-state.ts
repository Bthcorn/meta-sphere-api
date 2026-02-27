import { Position } from './dto/position';

export type UserID = string;

export interface UserStatePayload {
  userId: UserID;
  position: Position;
}

// allow up to 20 updates per second
const UPDATE_INTERVAL_MS = 50;

export class UserState {
  private position: Position = { x: 0, y: 0, z: 0 };
  private userId: UserID;
  private latestUpdate: Date = new Date();

  constructor(userId: UserID) {
    this.userId = userId;
    this.latestUpdate = new Date();
  }

  asPayload(): UserStatePayload {
    return {
      userId: this.userId,
      position: this.position,
    };
  }

  updatePosition(position: Position): boolean {
    const now = new Date();
    const shouldUpdate =
      now.getTime() - this.latestUpdate.getTime() >= UPDATE_INTERVAL_MS;

    if (shouldUpdate) {
      this.latestUpdate = now;
    }

    this.position = position;

    return shouldUpdate;
  }
}
