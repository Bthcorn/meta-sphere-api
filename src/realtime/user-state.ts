import { Position } from './dto/position';
import { AvatarAppearance } from './dto/avatar-appearance';

export type UserID = string;

export interface UserStatePayload {
  userId: UserID;
  username: string;
  roomId: string;
  position: Position;
  avatar: AvatarAppearance;
}

// allow up to 20 updates per second
const UPDATE_INTERVAL_MS = 50;

export class UserState {
  private position: Position = { x: 0, y: 0, z: 0, rotationY: 0 };
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

  setAvatar(appearance: AvatarAppearance): void {
    if (appearance.skinColor    !== undefined) this.avatar.skinColor    = appearance.skinColor;
    if (appearance.shirtColorId !== undefined) this.avatar.shirtColorId = appearance.shirtColorId;
    if (appearance.glassesId    !== undefined) this.avatar.glassesId    = appearance.glassesId;
    if (appearance.hatId        !== undefined) this.avatar.hatId        = appearance.hatId;
  }

  asPayload(): UserStatePayload {
    return {
      userId: this.userId,
      username: this.username,
      roomId: this.roomId,
      position: { ...this.position },
      avatar: { ...this.avatar },
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
