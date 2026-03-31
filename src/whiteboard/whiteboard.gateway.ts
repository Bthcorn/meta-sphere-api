import { UseGuards } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WhiteboardService } from './whiteboard.service';
import {
  StrokePayloadDto,
  StrokeUndoDto,
  SessionIdDto,
  DrawingStateDto,
} from './dto/whiteboard-stroke.dto';
import { CursorMoveDto } from './dto/cursor-move.dto';
import { WsJwtGuard } from '../realtime/guards/ws-jwt.guard';

@UseGuards(WsJwtGuard)
@WebSocketGateway({ cors: { origin: '*' } })
export class WhiteboardGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly whiteboardService: WhiteboardService) {}

  /**
   * Called when a user opens the whiteboard inside a session.
   * Sends them the full stroke history so they catch up instantly.
   */
  @SubscribeMessage('whiteboard:join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() { sessionId }: SessionIdDto,
  ) {
    await client.join(`session:${sessionId}`);
    const strokes = await this.whiteboardService.getStrokes(sessionId);
    client.emit('whiteboard:init', { strokes });
  }

  /**
   * Drawing state indicator — like a typing indicator but for drawing.
   * Frontend emits { isDrawing: true } on pointerdown, { isDrawing: false } on pointerup.
   * Relay only, never persisted.
   */
  @SubscribeMessage('whiteboard:drawing')
  handleDrawingState(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: DrawingStateDto,
  ) {
    client
      .to(`session:${payload.sessionId}`)
      .emit('whiteboard:drawing', payload);
  }

  /**
   * In-progress stroke (pointer move) — relay only, never persisted.
   * Keeps drawing smooth by skipping Redis entirely.
   */
  @SubscribeMessage('whiteboard:stroke:live')
  handleStrokeLive(
    @ConnectedSocket() client: Socket,
    @MessageBody() { sessionId, stroke }: StrokePayloadDto,
  ) {
    client.to(`session:${sessionId}`).emit('whiteboard:stroke:live', stroke);
  }

  /**
   * A stroke is complete (pointer up).
   * Persist to Redis, then broadcast to everyone else in the session room.
   */
  @SubscribeMessage('whiteboard:stroke')
  async handleStroke(
    @ConnectedSocket() client: Socket,
    @MessageBody() { sessionId, stroke }: StrokePayloadDto,
  ) {
    await this.whiteboardService.persistStroke(sessionId, stroke);
    client.to(`session:${sessionId}`).emit('whiteboard:stroke', stroke);
  }

  /**
   * Cursor movement — ephemeral, relay only, never persisted.
   */
  @SubscribeMessage('whiteboard:cursor')
  handleCursor(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CursorMoveDto,
  ) {
    client
      .to(`session:${payload.sessionId}`)
      .emit('whiteboard:cursor', payload);
  }

  /**
   * Undo the caller's last stroke.
   * Removes it from Redis and tells everyone else to remove it too.
   */
  @SubscribeMessage('whiteboard:undo')
  async handleUndo(
    @ConnectedSocket() client: Socket,
    @MessageBody() { sessionId, strokeId }: StrokeUndoDto,
  ) {
    await this.whiteboardService.removeStroke(sessionId, strokeId);
    client.to(`session:${sessionId}`).emit('whiteboard:undo', { strokeId });
  }

  /**
   * Clear the entire board.
   * Wipes Redis and broadcasts to all session participants.
   */
  @SubscribeMessage('whiteboard:clear')
  async handleClear(
    @ConnectedSocket() client: Socket,
    @MessageBody() { sessionId }: SessionIdDto,
  ) {
    await this.whiteboardService.clearBoard(sessionId);
    client.to(`session:${sessionId}`).emit('whiteboard:clear');
  }
}
