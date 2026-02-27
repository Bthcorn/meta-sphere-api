export type Position = { x: number; y: number; z: number };
export type UserID = string;

export interface UserStatePayload {
  userId: UserID;
  position: Position;
}

export class UserState {
  private position: Position = { x: 0, y: 0, z: 0 };
  private userId: UserID;

  constructor(userId: UserID) {
    this.userId = userId;
  }

  asPayload(): UserStatePayload {
    return {
      userId: this.userId,
      position: this.position,
    };
  }
}
