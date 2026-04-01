import { Test, TestingModule } from '@nestjs/testing';
import { Server, Socket } from 'socket.io';
import { ChatGateway } from './chat.gateway';
import { MessagesService } from '../messages/messages.service';
import { WsJwtGuard, WS_USER_KEY } from '../realtime/guards/ws-jwt.guard';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mockRoomMessage = {
  id: 'msg-1',
  content: 'Hello',
  type: 'TEXT',
  reactions: {},
  isDeleted: false,
  createdAt: new Date(),
  roomId: 'room-1',
  sessionId: null,
  sender: { id: 'user-1', username: 'alice', avatarPreset: 'avatar1' },
};

const mockSessionMessage = {
  ...mockRoomMessage,
  id: 'msg-2',
  sessionId: 'session-1',
};

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeMockSocket(userId: string, username: string) {
  const broadcastEmit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit: broadcastEmit });
  return {
    socket: {
      data: { [WS_USER_KEY]: { userId, username } },
      to,
      emit: jest.fn(),
    } as unknown as Socket,
    broadcastEmit,
    to,
  };
}

function makeMockServer() {
  const emit = jest.fn();
  const to = jest.fn().mockReturnValue({ emit });
  return { server: { to, emit } as unknown as Server, serverEmit: emit, serverTo: to };
}

// ── Mock service ──────────────────────────────────────────────────────────────

const mockMessagesService = {
  createMessage: jest.fn(),
  setTyping: jest.fn(),
  clearTyping: jest.fn(),
  toggleReaction: jest.fn(),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let serverTo: jest.Mock;
  let serverEmit: jest.Mock;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: MessagesService, useValue: mockMessagesService },
      ],
    })
      .overrideGuard(WsJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    gateway = module.get<ChatGateway>(ChatGateway);

    const { server, serverEmit: se, serverTo: st } = makeMockServer();
    gateway.server = server;
    serverEmit = se;
    serverTo = st;

    jest.clearAllMocks();

    // Re-apply the server mock after clearAllMocks
    serverEmit = jest.fn();
    serverTo = jest.fn().mockReturnValue({ emit: serverEmit });
    gateway.server = { to: serverTo, emit: serverEmit } as unknown as Server;
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  // ── handleChatSend ────────────────────────────────────────────────────────

  describe('handleChatSend', () => {
    it('should create a message and emit it to the room channel', async () => {
      mockMessagesService.createMessage.mockResolvedValue(mockRoomMessage);
      const { socket } = makeMockSocket('user-1', 'alice');

      await gateway.handleChatSend(socket, {
        content: 'Hello',
        roomId: 'room-1',
        sessionId: undefined,
      });

      expect(mockMessagesService.createMessage).toHaveBeenCalledWith({
        content: 'Hello',
        senderId: 'user-1',
        roomId: 'room-1',
        sessionId: undefined,
      });
      expect(serverTo).toHaveBeenCalledWith('room:room-1');
      expect(serverEmit).toHaveBeenCalledWith('chat:message', mockRoomMessage);
    });

    it('should emit to the session channel when sessionId is provided', async () => {
      mockMessagesService.createMessage.mockResolvedValue(mockSessionMessage);
      const { socket } = makeMockSocket('user-1', 'alice');

      await gateway.handleChatSend(socket, {
        content: 'Hello session',
        roomId: 'room-1',
        sessionId: 'session-1',
      });

      expect(serverTo).toHaveBeenCalledWith('session:session-1');
      expect(serverEmit).toHaveBeenCalledWith(
        'chat:message',
        mockSessionMessage,
      );
    });
  });

  // ── handleChatTyping ──────────────────────────────────────────────────────

  describe('handleChatTyping', () => {
    it('should set typing state and broadcast to the room scope', async () => {
      mockMessagesService.setTyping.mockResolvedValue(undefined);
      const { socket, broadcastEmit, to } = makeMockSocket('user-1', 'alice');

      await gateway.handleChatTyping(socket, {
        isTyping: true,
        roomId: 'room-1',
        sessionId: undefined,
      });

      expect(mockMessagesService.setTyping).toHaveBeenCalledWith(
        'room:room-1',
        'user-1',
        'alice',
      );
      expect(to).toHaveBeenCalledWith('room:room-1');
      expect(broadcastEmit).toHaveBeenCalledWith('chat:typing', {
        userId: 'user-1',
        username: 'alice',
        isTyping: true,
      });
    });

    it('should clear typing state when isTyping is false', async () => {
      mockMessagesService.clearTyping.mockResolvedValue(undefined);
      const { socket, broadcastEmit } = makeMockSocket('user-1', 'alice');

      await gateway.handleChatTyping(socket, {
        isTyping: false,
        roomId: 'room-1',
        sessionId: undefined,
      });

      expect(mockMessagesService.clearTyping).toHaveBeenCalledWith(
        'room:room-1',
        'user-1',
      );
      expect(mockMessagesService.setTyping).not.toHaveBeenCalled();
      expect(broadcastEmit).toHaveBeenCalledWith('chat:typing', {
        userId: 'user-1',
        username: 'alice',
        isTyping: false,
      });
    });

    it('should use the session scope when sessionId is provided', async () => {
      mockMessagesService.setTyping.mockResolvedValue(undefined);
      const { socket, to } = makeMockSocket('user-1', 'alice');

      await gateway.handleChatTyping(socket, {
        isTyping: true,
        roomId: 'room-1',
        sessionId: 'session-1',
      });

      expect(mockMessagesService.setTyping).toHaveBeenCalledWith(
        'session:session-1',
        'user-1',
        'alice',
      );
      expect(to).toHaveBeenCalledWith('session:session-1');
    });
  });

  // ── handleChatReaction ────────────────────────────────────────────────────

  describe('handleChatReaction', () => {
    it('should toggle reaction and emit updated reactions to the room channel', async () => {
      const updated = {
        ...mockRoomMessage,
        reactions: { '👍': ['user-1'] },
      };
      mockMessagesService.toggleReaction.mockResolvedValue(updated);
      const { socket } = makeMockSocket('user-1', 'alice');

      await gateway.handleChatReaction(socket, {
        messageId: 'msg-1',
        emoji: '👍',
      });

      expect(mockMessagesService.toggleReaction).toHaveBeenCalledWith(
        'msg-1',
        'user-1',
        '👍',
      );
      expect(serverTo).toHaveBeenCalledWith('room:room-1');
      expect(serverEmit).toHaveBeenCalledWith('chat:reaction', {
        messageId: 'msg-1',
        reactions: { '👍': ['user-1'] },
      });
    });

    it('should emit to the session channel when the message belongs to a session', async () => {
      const updated = {
        ...mockRoomMessage,
        sessionId: 'session-1',
        reactions: {},
      };
      mockMessagesService.toggleReaction.mockResolvedValue(updated);
      const { socket } = makeMockSocket('user-1', 'alice');

      await gateway.handleChatReaction(socket, {
        messageId: 'msg-2',
        emoji: '❤️',
      });

      expect(serverTo).toHaveBeenCalledWith('session:session-1');
    });
  });
});
