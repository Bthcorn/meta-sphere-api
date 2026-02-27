import { Injectable } from '@nestjs/common';
import { UserID, UserState, UserStatePayload } from './user-state';

export type ConnectionID = string;

@Injectable()
export class StateService {
  private connections: Map<ConnectionID, UserState> = new Map();

  newConnection(connection: ConnectionID, userId: UserID) {
    const userState = new UserState(userId);

    this.connections.set(connection, userState);
  }

  disconnect(connection: ConnectionID): UserID {
    const state = this.getUserState(connection);

    this.connections.delete(connection);

    return state.userId;
  }

  getUserState(connection: ConnectionID): UserStatePayload {
    const state = this.connections.get(connection);

    if (!state) {
      throw new Error(`No state found for connection ${connection}`);
    }

    return state.asPayload();
  }

  getAllStates(): UserStatePayload[] {
    const array: UserStatePayload[] = [];

    for (const state of this.connections.values()) {
      array.push(state.asPayload());
    }

    return array;
  }

  updatePosition(
    connection: ConnectionID,
    position: { x: number; y: number; z: number },
  ): boolean {
    const state = this.connections.get(connection);

    if (!state) {
      throw new Error(`No state found for connection ${connection}`);
    }

    return state.updatePosition(position);
  }
}
