import { Position, AvatarAppearance } from './dto/position';

export type UserID = string;

export interface UserStatePayload {
  userId: UserID;
  username: string;
  roomId: string;
  position: Position;
}

// allow up to 20 updates per second
const UPDATE_INTERVAL_MS = 50;

export class UserState {
  private position: Omit<Position, 'avatar'> = { x: 0, y: 0, z: 0, rotationY: 0 };
  private avatar: AvatarAppearance = {};
  private userId: UserID;
  private username: string;
  private roomId: string;
  private latestUpdate: Date = new Date();

  constructor(userId: UserID, username: string, roomId: string = 'common_area') {
    this.userId = userId;
    this.username = username;
    this.roomId = roomId;
    this.latestUpdate = new Date();
  }

  get currentUserRoom(): string {
    return this.roomId;
  }

  setRoom(roomId: string) {
    this.roomId = roomId;
  }

  asPayload(): UserStatePayload {
    return {
      userId: this.userId,
      username: this.username,
      roomId: this.roomId,
      position: { ...this.position, avatar: { ...this.avatar } },
    };
  }

  updatePosition(position: Position): boolean {
    const now = new Date();
    const shouldUpdate =
      now.getTime() - this.latestUpdate.getTime() >= UPDATE_INTERVAL_MS;

    if (shouldUpdate) {
      this.latestUpdate = now;
    }

    const { avatar, ...movement } = position;
    this.position = movement;

    // Merge incoming avatar fields — only overwrite what was actually sent.
    if (avatar) {
      if (avatar.skinColor    !== undefined) this.avatar.skinColor    = avatar.skinColor;
      if (avatar.shirtColorId !== undefined) this.avatar.shirtColorId = avatar.shirtColorId;
      if (avatar.glassesId    !== undefined) this.avatar.glassesId    = avatar.glassesId;
      if (avatar.hatId        !== undefined) this.avatar.hatId        = avatar.hatId;
    }

    return shouldUpdate;
  }
}
