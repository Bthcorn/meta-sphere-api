import { Injectable } from '@nestjs/common';
import { UserID, UserState, UserStatePayload } from './user-state';

export type ConnectionID = string;

@Injectable()
export class StateService {
  private connections: Map<ConnectionID, UserState> = new Map();
  private connnectionsByRoom: Map<string, Set<ConnectionID>> = new Map();

  newConnection(connection: ConnectionID, userId: UserID, roomId: string) {
    const userState = new UserState(userId, roomId);

    this.connections.set(connection, userState);

    if (!this.connnectionsByRoom.has(roomId)) {
      this.connnectionsByRoom.set(roomId, new Set());
    }

    this.connnectionsByRoom.get(roomId)!.add(connection);
  }

  disconnect(connection: ConnectionID): UserID {
    const state = this.getUserState(connection);

    this.connections.delete(connection);
    this.connnectionsByRoom.get(state.currentUserRoom)?.delete(connection);

    return state.asPayload().userId;
  }

  getUserStatePayload(connection: ConnectionID): UserStatePayload {
    return this.getUserState(connection).asPayload();
  }

  changeRoom(connection: ConnectionID, newRoomId: string): void {
    const state = this.getUserState(connection);
    const oldRoom = state.currentUserRoom;

    if (oldRoom === newRoomId) return;

    this.connnectionsByRoom.get(oldRoom)?.delete(connection);

    state.setRoom(newRoomId);

    if (!this.connnectionsByRoom.has(newRoomId)) {
      this.connnectionsByRoom.set(newRoomId, new Set());
    }
    this.connnectionsByRoom.get(newRoomId)!.add(connection);
  }

  getUserState(connection: ConnectionID): UserState {
    const state = this.connections.get(connection);

    if (!state) {
      throw new Error(`No state found for connection ${connection}`);
    }

    return state;
  }

  getAllStates(roomId: string): UserStatePayload[] {
    const connections = this.connnectionsByRoom.get(roomId);

    if (!connections) {
      return [];
    }

    return Array.from(connections).map((connId) =>
      this.getUserState(connId).asPayload(),
    );
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
