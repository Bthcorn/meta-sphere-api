import { Test, TestingModule } from '@nestjs/testing';
import { WhiteboardGateway } from './whiteboard.gateway';
import { WhiteboardService } from './whiteboard.service';
import { WsJwtGuard } from '../realtime/guards/ws-jwt.guard';
import type { Socket } from 'socket.io';
import type { WhiteboardStrokeDto } from './dto/whiteboard-stroke.dto';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION_ID = 'session-abc';

const mockStroke: WhiteboardStrokeDto = {
  id: 'stroke-1',
  type: 'pen',
  points: [0, 0, 10, 10],
  color: '#ff0000',
  width: 3,
  userId: 'user-1',
  timestamp: 1700000000000,
};

const mockStrokeList: WhiteboardStrokeDto[] = [mockStroke];

// ── Mock WhiteboardService ────────────────────────────────────────────────────

const mockWhiteboardService = {
  persistStroke: jest.fn(),
  getStrokes: jest.fn(),
  removeStroke: jest.fn(),
  clearBoard: jest.fn(),
};

// ── Mock Socket ───────────────────────────────────────────────────────────────

// client.to('room').emit('event', data) is a two-step chain,
// so we need a broadcast object that `to()` returns.
const mockBroadcast = { emit: jest.fn() };

const mockClient = {
  emit: jest.fn(),
  join: jest.fn(),
  to: jest.fn().mockReturnValue(mockBroadcast),
} as unknown as Socket;

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('WhiteboardGateway', () => {
  let gateway: WhiteboardGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhiteboardGateway,
        { provide: WhiteboardService, useValue: mockWhiteboardService },
      ],
    })
      .overrideGuard(WsJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    gateway = module.get<WhiteboardGateway>(WhiteboardGateway);
    jest.clearAllMocks();

    // Restore the to() chain after clearAllMocks resets the return value
    (mockClient.to as jest.Mock).mockReturnValue(mockBroadcast);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  // ── whiteboard:join ───────────────────────────────────────────────────────

  describe('handleJoin', () => {
    it('should fetch strokes from service and emit whiteboard:init to the caller', async () => {
      mockWhiteboardService.getStrokes.mockResolvedValue(mockStrokeList);

      await gateway.handleJoin(mockClient, { sessionId: SESSION_ID });

      expect(mockWhiteboardService.getStrokes).toHaveBeenCalledWith(SESSION_ID);
      expect(mockClient.emit).toHaveBeenCalledWith('whiteboard:init', {
        strokes: mockStrokeList,
      });
    });

    it('should emit an empty strokes array when the board is fresh', async () => {
      mockWhiteboardService.getStrokes.mockResolvedValue([]);

      await gateway.handleJoin(mockClient, { sessionId: SESSION_ID });

      expect(mockClient.emit).toHaveBeenCalledWith('whiteboard:init', {
        strokes: [],
      });
    });

    it('should NOT broadcast to the session room on join', async () => {
      mockWhiteboardService.getStrokes.mockResolvedValue(mockStrokeList);

      await gateway.handleJoin(mockClient, { sessionId: SESSION_ID });

      expect(mockClient.to).not.toHaveBeenCalled();
    });
  });

  // ── whiteboard:stroke ─────────────────────────────────────────────────────

  describe('handleStroke', () => {
    it('should persist the stroke and broadcast it to the session room', async () => {
      mockWhiteboardService.persistStroke.mockResolvedValue(undefined);

      await gateway.handleStroke(mockClient, {
        sessionId: SESSION_ID,
        stroke: mockStroke,
      });

      expect(mockWhiteboardService.persistStroke).toHaveBeenCalledWith(
        SESSION_ID,
        mockStroke,
      );
      expect(mockClient.to).toHaveBeenCalledWith(`session:${SESSION_ID}`);
      expect(mockBroadcast.emit).toHaveBeenCalledWith(
        'whiteboard:stroke',
        mockStroke,
      );
    });

    it('should broadcast the exact stroke object received, unmodified', async () => {
      mockWhiteboardService.persistStroke.mockResolvedValue(undefined);

      const customStroke: WhiteboardStrokeDto = {
        ...mockStroke,
        id: 'stroke-custom',
        type: 'shape',
        color: '#00ff00',
      };

      await gateway.handleStroke(mockClient, {
        sessionId: SESSION_ID,
        stroke: customStroke,
      });

      expect(mockBroadcast.emit).toHaveBeenCalledWith(
        'whiteboard:stroke',
        customStroke,
      );
    });

    it('should NOT emit whiteboard:stroke back to the sender', async () => {
      mockWhiteboardService.persistStroke.mockResolvedValue(undefined);

      await gateway.handleStroke(mockClient, {
        sessionId: SESSION_ID,
        stroke: mockStroke,
      });

      expect(mockClient.emit).not.toHaveBeenCalledWith(
        'whiteboard:stroke',
        expect.anything(),
      );
    });
  });

  // ── whiteboard:cursor ─────────────────────────────────────────────────────

  describe('handleCursor', () => {
    const cursorPayload = {
      sessionId: SESSION_ID,
      x: 120,
      y: 80,
      userId: 'user-1',
      username: 'alice',
    };

    it('should relay the cursor payload to the session room', () => {
      gateway.handleCursor(mockClient, cursorPayload);

      expect(mockClient.to).toHaveBeenCalledWith(`session:${SESSION_ID}`);
      expect(mockBroadcast.emit).toHaveBeenCalledWith(
        'whiteboard:cursor',
        cursorPayload,
      );
    });

    it('should never call WhiteboardService (cursor is ephemeral)', () => {
      gateway.handleCursor(mockClient, cursorPayload);

      expect(mockWhiteboardService.persistStroke).not.toHaveBeenCalled();
      expect(mockWhiteboardService.getStrokes).not.toHaveBeenCalled();
      expect(mockWhiteboardService.removeStroke).not.toHaveBeenCalled();
      expect(mockWhiteboardService.clearBoard).not.toHaveBeenCalled();
    });

    it('should NOT emit whiteboard:cursor back to the sender', () => {
      gateway.handleCursor(mockClient, cursorPayload);

      expect(mockClient.emit).not.toHaveBeenCalled();
    });
  });

  // ── whiteboard:undo ───────────────────────────────────────────────────────

  describe('handleUndo', () => {
    it('should remove the stroke from service and broadcast the strokeId', async () => {
      mockWhiteboardService.removeStroke.mockResolvedValue(undefined);

      await gateway.handleUndo(mockClient, {
        sessionId: SESSION_ID,
        strokeId: 'stroke-1',
      });

      expect(mockWhiteboardService.removeStroke).toHaveBeenCalledWith(
        SESSION_ID,
        'stroke-1',
      );
      expect(mockClient.to).toHaveBeenCalledWith(`session:${SESSION_ID}`);
      expect(mockBroadcast.emit).toHaveBeenCalledWith('whiteboard:undo', {
        strokeId: 'stroke-1',
      });
    });

    it('should broadcast only the strokeId, not the full stroke object', async () => {
      mockWhiteboardService.removeStroke.mockResolvedValue(undefined);

      await gateway.handleUndo(mockClient, {
        sessionId: SESSION_ID,
        strokeId: 'stroke-1',
      });

      const broadcastPayload = mockBroadcast.emit.mock.calls[0][1];
      expect(broadcastPayload).toEqual({ strokeId: 'stroke-1' });
      expect(broadcastPayload).not.toHaveProperty('points');
      expect(broadcastPayload).not.toHaveProperty('color');
    });
  });

  // ── whiteboard:clear ──────────────────────────────────────────────────────

  describe('handleClear', () => {
    it('should clear the board in service and broadcast whiteboard:clear', async () => {
      mockWhiteboardService.clearBoard.mockResolvedValue(undefined);

      await gateway.handleClear(mockClient, { sessionId: SESSION_ID });

      expect(mockWhiteboardService.clearBoard).toHaveBeenCalledWith(SESSION_ID);
      expect(mockClient.to).toHaveBeenCalledWith(`session:${SESSION_ID}`);
      expect(mockBroadcast.emit).toHaveBeenCalledWith('whiteboard:clear');
    });

    it('should broadcast with no payload on clear', async () => {
      mockWhiteboardService.clearBoard.mockResolvedValue(undefined);

      await gateway.handleClear(mockClient, { sessionId: SESSION_ID });

      // emit called with exactly one argument (the event name), no data
      const broadcastCall = mockBroadcast.emit.mock.calls[0];
      expect(broadcastCall).toHaveLength(1);
      expect(broadcastCall[0]).toBe('whiteboard:clear');
    });

    it('should NOT emit whiteboard:clear back to the sender', async () => {
      mockWhiteboardService.clearBoard.mockResolvedValue(undefined);

      await gateway.handleClear(mockClient, { sessionId: SESSION_ID });

      expect(mockClient.emit).not.toHaveBeenCalled();
    });
  });

  // ── session room key format ───────────────────────────────────────────────

  describe('session room key', () => {
    it('should always use session:{sessionId} format for all broadcasting events', async () => {
      mockWhiteboardService.persistStroke.mockResolvedValue(undefined);
      mockWhiteboardService.removeStroke.mockResolvedValue(undefined);
      mockWhiteboardService.clearBoard.mockResolvedValue(undefined);

      await gateway.handleStroke(mockClient, {
        sessionId: SESSION_ID,
        stroke: mockStroke,
      });
      await gateway.handleUndo(mockClient, {
        sessionId: SESSION_ID,
        strokeId: 'stroke-1',
      });
      await gateway.handleClear(mockClient, { sessionId: SESSION_ID });
      gateway.handleCursor(mockClient, {
        sessionId: SESSION_ID,
        x: 0,
        y: 0,
        userId: 'u',
        username: 'u',
      });

      const allRoomArgs = (mockClient.to as jest.Mock).mock.calls.map(
        (call) => call[0],
      );

      expect(allRoomArgs).toHaveLength(4);
      allRoomArgs.forEach((room) => {
        expect(room).toBe(`session:${SESSION_ID}`);
      });
    });
  });
});
