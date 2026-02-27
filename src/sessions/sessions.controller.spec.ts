import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import {
  SessionStatus,
  SessionType,
  ParticipantRole,
  ParticipantStatus,
  SessionEventType,
  UserRole,
} from 'src/generated/prisma/client';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const hostUser: JwtUser = { userId: 'user-host', username: 'host', role: UserRole.USER };
const memberUser: JwtUser = { userId: 'user-member', username: 'member', role: UserRole.USER };

const mockSession = {
  id: 'session-1',
  roomId: 'room-1',
  hostId: 'user-host',
  title: 'Algo Study',
  description: null,
  type: SessionType.STUDY,
  status: SessionStatus.SCHEDULED,
  scheduledStartTime: null,
  actualStartTime: null,
  actualEndTime: null,
  isLocked: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { sessionParticipants: 1 },
};

const activeSession = { ...mockSession, status: SessionStatus.ACTIVE };

const mockParticipants = [
  {
    id: 'sp-1',
    sessionId: 'session-1',
    userId: 'user-host',
    role: ParticipantRole.HOST,
    status: ParticipantStatus.ACTIVE,
    joinedAt: new Date(),
    leftAt: null,
    user: { id: 'user-host', username: 'host', firstName: 'Host', lastName: 'User', profilePicture: null, avatarPreset: 'avatar1', status: 'AVAILABLE' },
  },
];

const mockLogs = [
  { id: 'log-1', sessionId: 'session-1', eventType: SessionEventType.SESSION_STARTED, userId: 'user-host', metadata: null, createdAt: new Date() },
];

// ── Mock service ──────────────────────────────────────────────────────────────

const mockSessionsService = {
  findAll: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  start: jest.fn(),
  end: jest.fn(),
  join: jest.fn(),
  leave: jest.fn(),
  getParticipants: jest.fn(),
  kickParticipant: jest.fn(),
  getLogs: jest.fn(),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('SessionsController', () => {
  let controller: SessionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [{ provide: SessionsService, useValue: mockSessionsService }],
    }).compile();

    controller = module.get<SessionsController>(SessionsController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── GET /sessions ─────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return sessions passing the query through', async () => {
      mockSessionsService.findAll.mockResolvedValue([mockSession]);

      const result = await controller.findAll({ roomId: 'room-1', status: SessionStatus.SCHEDULED });

      expect(mockSessionsService.findAll).toHaveBeenCalledWith({
        roomId: 'room-1',
        status: SessionStatus.SCHEDULED,
      });
      expect(result).toHaveLength(1);
    });

    it('should return empty array when no sessions match', async () => {
      mockSessionsService.findAll.mockResolvedValue([]);

      const result = await controller.findAll({});

      expect(result).toEqual([]);
    });
  });

  // ── POST /sessions ────────────────────────────────────────────────────────

  describe('create', () => {
    it('should pass hostId and dto to the service', async () => {
      mockSessionsService.create.mockResolvedValue(mockSession);
      const dto = { roomId: 'room-1', title: 'Algo Study', type: SessionType.STUDY };

      const result = await controller.create(hostUser, dto);

      expect(mockSessionsService.create).toHaveBeenCalledWith('user-host', dto);
      expect(result.id).toBe('session-1');
    });

    it('should propagate NotFoundException from the service', async () => {
      mockSessionsService.create.mockRejectedValue(new NotFoundException());

      await expect(
        controller.create(hostUser, { roomId: 'bad', title: 'x', type: SessionType.STUDY }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── GET /sessions/:id ─────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return a session by id', async () => {
      mockSessionsService.findById.mockResolvedValue(mockSession);

      const result = await controller.findOne('session-1');

      expect(mockSessionsService.findById).toHaveBeenCalledWith('session-1');
      expect(result.id).toBe('session-1');
    });

    it('should propagate NotFoundException', async () => {
      mockSessionsService.findById.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne('bad')).rejects.toThrow(NotFoundException);
    });
  });

  // ── PATCH /sessions/:id ───────────────────────────────────────────────────

  describe('update', () => {
    it('should pass id, userId and dto to the service', async () => {
      const updated = { ...mockSession, title: 'New Title' };
      mockSessionsService.update.mockResolvedValue(updated);

      const result = await controller.update('session-1', hostUser, { title: 'New Title' });

      expect(mockSessionsService.update).toHaveBeenCalledWith('session-1', 'user-host', { title: 'New Title' });
      expect(result.title).toBe('New Title');
    });
  });

  // ── POST /sessions/:id/start ──────────────────────────────────────────────

  describe('start', () => {
    it('should start the session', async () => {
      mockSessionsService.start.mockResolvedValue(activeSession);

      const result = await controller.start('session-1', hostUser);

      expect(mockSessionsService.start).toHaveBeenCalledWith('session-1', 'user-host');
      expect(result.status).toBe(SessionStatus.ACTIVE);
    });

    it('should propagate ConflictException when already started', async () => {
      mockSessionsService.start.mockRejectedValue(new ConflictException());

      await expect(controller.start('session-1', hostUser)).rejects.toThrow(ConflictException);
    });
  });

  // ── POST /sessions/:id/end ────────────────────────────────────────────────

  describe('end', () => {
    it('should end the session', async () => {
      const ended = { ...activeSession, status: SessionStatus.ENDED };
      mockSessionsService.end.mockResolvedValue(ended);

      const result = await controller.end('session-1', hostUser);

      expect(mockSessionsService.end).toHaveBeenCalledWith('session-1', 'user-host');
      expect(result.status).toBe(SessionStatus.ENDED);
    });

    it('should propagate ConflictException when not ACTIVE', async () => {
      mockSessionsService.end.mockRejectedValue(new ConflictException());

      await expect(controller.end('session-1', hostUser)).rejects.toThrow(ConflictException);
    });
  });

  // ── POST /sessions/:id/join ───────────────────────────────────────────────

  describe('join', () => {
    it('should join without a password', async () => {
      mockSessionsService.join.mockResolvedValue({ message: 'Joined session successfully' });

      const result = await controller.join('session-1', memberUser, {});

      expect(mockSessionsService.join).toHaveBeenCalledWith('session-1', 'user-member', undefined);
      expect(result.message).toBe('Joined session successfully');
    });

    it('should pass the password when provided', async () => {
      mockSessionsService.join.mockResolvedValue({ message: 'Joined session successfully' });

      await controller.join('session-1', memberUser, { password: 'secret' });

      expect(mockSessionsService.join).toHaveBeenCalledWith('session-1', 'user-member', 'secret');
    });

    it('should propagate errors from the service', async () => {
      mockSessionsService.join.mockRejectedValue(new ConflictException());

      await expect(controller.join('session-1', memberUser, {})).rejects.toThrow(ConflictException);
    });
  });

  // ── POST /sessions/:id/leave ──────────────────────────────────────────────

  describe('leave', () => {
    it('should leave the session', async () => {
      mockSessionsService.leave.mockResolvedValue({ message: 'Left session successfully' });

      const result = await controller.leave('session-1', memberUser);

      expect(mockSessionsService.leave).toHaveBeenCalledWith('session-1', 'user-member');
      expect(result.message).toBe('Left session successfully');
    });

    it('should propagate errors from the service', async () => {
      mockSessionsService.leave.mockRejectedValue(new ConflictException());

      await expect(controller.leave('session-1', memberUser)).rejects.toThrow(ConflictException);
    });
  });

  // ── GET /sessions/:id/participants ────────────────────────────────────────

  describe('getParticipants', () => {
    it('should return participants', async () => {
      mockSessionsService.getParticipants.mockResolvedValue(mockParticipants);

      const result = await controller.getParticipants('session-1');

      expect(mockSessionsService.getParticipants).toHaveBeenCalledWith('session-1');
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe(ParticipantRole.HOST);
    });

    it('should propagate NotFoundException', async () => {
      mockSessionsService.getParticipants.mockRejectedValue(new NotFoundException());

      await expect(controller.getParticipants('bad')).rejects.toThrow(NotFoundException);
    });
  });

  // ── DELETE /sessions/:id/participants/:userId ─────────────────────────────

  describe('kickParticipant', () => {
    it('should kick the target participant', async () => {
      mockSessionsService.kickParticipant.mockResolvedValue({ message: 'Participant removed from session' });

      const result = await controller.kickParticipant('session-1', 'user-member', hostUser);

      expect(mockSessionsService.kickParticipant).toHaveBeenCalledWith(
        'session-1',
        'user-host',
        'user-member',
      );
      expect(result.message).toBe('Participant removed from session');
    });

    it('should propagate errors from the service', async () => {
      mockSessionsService.kickParticipant.mockRejectedValue(new NotFoundException());

      await expect(
        controller.kickParticipant('session-1', 'user-ghost', hostUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── GET /sessions/:id/logs ────────────────────────────────────────────────

  describe('getLogs', () => {
    it('should return session logs', async () => {
      mockSessionsService.getLogs.mockResolvedValue(mockLogs);

      const result = await controller.getLogs('session-1');

      expect(mockSessionsService.getLogs).toHaveBeenCalledWith('session-1');
      expect(result).toHaveLength(1);
      expect(result[0].eventType).toBe(SessionEventType.SESSION_STARTED);
    });

    it('should propagate NotFoundException', async () => {
      mockSessionsService.getLogs.mockRejectedValue(new NotFoundException());

      await expect(controller.getLogs('bad')).rejects.toThrow(NotFoundException);
    });
  });
});
