import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { SessionsService } from './sessions.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  SessionStatus,
  SessionType,
  SessionEventType,
  ParticipantRole,
  ParticipantStatus,
} from 'src/generated/prisma/client';

// ── Fixtures ────────────────────────────────────────────────────────────────

const mockRoom = { id: 'room-1', isActive: true };

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
  password: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { sessionParticipants: 1 },
};

const activeSession = { ...mockSession, status: SessionStatus.ACTIVE };

const hostParticipant = {
  id: 'sp-host',
  sessionId: 'session-1',
  userId: 'user-host',
  role: ParticipantRole.HOST,
  status: ParticipantStatus.ACTIVE,
  joinedAt: new Date(),
  leftAt: null,
};

const memberParticipant = {
  id: 'sp-member',
  sessionId: 'session-1',
  userId: 'user-member',
  role: ParticipantRole.PARTICIPANT,
  status: ParticipantStatus.ACTIVE,
  joinedAt: new Date(),
  leftAt: null,
};

// ── Mock PrismaService ───────────────────────────────────────────────────────

const mockPrisma = {
  room: { findUnique: jest.fn() },
  session: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  sessionParticipant: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  sessionLog: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

// ── Suite ────────────────────────────────────────────────────────────────────

describe('SessionsService', () => {
  let service: SessionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return sessions with password stripped', async () => {
      const sessionWithPw = { ...mockSession, password: 'hashed' };
      mockPrisma.session.findMany.mockResolvedValue([sessionWithPw]);

      const result = await service.findAll({});

      expect(result[0]).not.toHaveProperty('password');
    });

    it('should forward roomId and status filters', async () => {
      mockPrisma.session.findMany.mockResolvedValue([]);

      await service.findAll({ roomId: 'room-1', status: SessionStatus.ACTIVE });

      expect(mockPrisma.session.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { roomId: 'room-1', status: SessionStatus.ACTIVE },
        }),
      );
    });

    it('should omit undefined filters from where clause', async () => {
      mockPrisma.session.findMany.mockResolvedValue([]);

      await service.findAll({});

      const [call] = mockPrisma.session.findMany.mock.calls as [{ where: object }][];
      expect(call[0].where).toEqual({});
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a session and auto-enroll the host', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.session.create.mockResolvedValue(mockSession);
      mockPrisma.sessionParticipant.create.mockResolvedValue(hostParticipant);

      const result = await service.create('user-host', {
        roomId: 'room-1',
        title: 'Algo Study',
        type: SessionType.STUDY,
      });

      expect(mockPrisma.session.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.sessionParticipant.create).toHaveBeenCalledWith({
        data: {
          sessionId: 'session-1',
          userId: 'user-host',
          role: ParticipantRole.HOST,
        },
      });
      expect(result).not.toHaveProperty('password');
    });

    it('should hash the password if provided', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.session.create.mockResolvedValue(mockSession);
      mockPrisma.sessionParticipant.create.mockResolvedValue(hostParticipant);

      await service.create('user-host', {
        roomId: 'room-1',
        title: 'Secret Session',
        type: SessionType.STUDY,
        password: 'plaintext',
      });

      const { data } = mockPrisma.session.create.mock.calls[0][0] as {
        data: { password: string };
      };
      expect(data.password).not.toBe('plaintext');
      expect(data.password).toMatch(/^\$2b\$/);
    });

    it('should throw NotFoundException when room does not exist', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(null);

      await expect(
        service.create('user-host', {
          roomId: 'bad-room',
          title: 'Test',
          type: SessionType.STUDY,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when room is inactive', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({ ...mockRoom, isActive: false });

      await expect(
        service.create('user-host', {
          roomId: 'room-1',
          title: 'Test',
          type: SessionType.STUDY,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('should return session without password', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);

      const result = await service.findById('session-1');

      expect(result).not.toHaveProperty('password');
      expect(result.id).toBe('session-1');
    });

    it('should throw NotFoundException when session does not exist', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);

      await expect(service.findById('bad')).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update session as host', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);
      mockPrisma.session.update.mockResolvedValue({ ...mockSession, title: 'New Title' });

      const result = await service.update('session-1', 'user-host', { title: 'New Title' });

      expect(mockPrisma.session.update).toHaveBeenCalled();
      expect(result).not.toHaveProperty('password');
    });

    it('should throw ForbiddenException when caller is not the host', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);

      await expect(
        service.update('session-1', 'user-other', { title: 'Hack' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when session is ENDED', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        ...mockSession,
        status: SessionStatus.ENDED,
      });

      await expect(
        service.update('session-1', 'user-host', { title: 'Too late' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should log SESSION_LOCKED when isLocked changes to true', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({ ...mockSession, isLocked: false });
      mockPrisma.session.update.mockResolvedValue({ ...mockSession, isLocked: true });
      mockPrisma.sessionLog.create.mockResolvedValue({});

      await service.update('session-1', 'user-host', { isLocked: true });

      expect(mockPrisma.sessionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventType: SessionEventType.SESSION_LOCKED }),
      });
    });

    it('should log SESSION_UNLOCKED when isLocked changes to false', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({ ...mockSession, isLocked: true });
      mockPrisma.session.update.mockResolvedValue({ ...mockSession, isLocked: false });
      mockPrisma.sessionLog.create.mockResolvedValue({});

      await service.update('session-1', 'user-host', { isLocked: false });

      expect(mockPrisma.sessionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventType: SessionEventType.SESSION_UNLOCKED }),
      });
    });
  });

  // ── start ────────────────────────────────────────────────────────────────

  describe('start', () => {
    it('should start a SCHEDULED session', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);
      mockPrisma.session.update.mockResolvedValue(activeSession);
      mockPrisma.sessionLog.create.mockResolvedValue({});

      const result = await service.start('session-1', 'user-host');

      expect(mockPrisma.session.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: SessionStatus.ACTIVE }),
        }),
      );
      expect(mockPrisma.sessionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventType: SessionEventType.SESSION_STARTED }),
      });
      expect(result.status).toBe(SessionStatus.ACTIVE);
    });

    it('should throw ForbiddenException when caller is not the host', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);

      await expect(service.start('session-1', 'user-other')).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException when session is already ACTIVE', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(activeSession);

      await expect(service.start('session-1', 'user-host')).rejects.toThrow(ConflictException);
    });
  });

  // ── end ──────────────────────────────────────────────────────────────────

  describe('end', () => {
    it('should end an ACTIVE session and close participants', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(activeSession);
      mockPrisma.sessionParticipant.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.session.update.mockResolvedValue({
        ...activeSession,
        status: SessionStatus.ENDED,
      });
      mockPrisma.sessionLog.create.mockResolvedValue({});

      const result = await service.end('session-1', 'user-host');

      expect(mockPrisma.sessionParticipant.updateMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1', status: ParticipantStatus.ACTIVE },
        data: { status: ParticipantStatus.LEFT, leftAt: expect.any(Date) },
      });
      expect(mockPrisma.sessionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventType: SessionEventType.SESSION_ENDED }),
      });
      expect(result.status).toBe(SessionStatus.ENDED);
    });

    it('should throw ForbiddenException when caller is not the host', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(activeSession);

      await expect(service.end('session-1', 'user-other')).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException when session is not ACTIVE', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession); // SCHEDULED

      await expect(service.end('session-1', 'user-host')).rejects.toThrow(ConflictException);
    });
  });

  // ── join ─────────────────────────────────────────────────────────────────

  describe('join', () => {
    it('should join an open session with no password', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue(null);
      mockPrisma.sessionParticipant.create.mockResolvedValue(memberParticipant);
      mockPrisma.sessionLog.create.mockResolvedValue({});

      const result = await service.join('session-1', 'user-member');

      expect(mockPrisma.sessionParticipant.create).toHaveBeenCalled();
      expect(mockPrisma.sessionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventType: SessionEventType.USER_JOINED }),
      });
      expect(result.message).toBe('Joined session successfully');
    });

    it('should return early when user is already ACTIVE', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue(memberParticipant);

      const result = await service.join('session-1', 'user-member');

      expect(mockPrisma.sessionParticipant.create).not.toHaveBeenCalled();
      expect(result.message).toBe('Already in session');
    });

    it('should throw ForbiddenException when user was KICKED', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue({
        ...memberParticipant,
        status: ParticipantStatus.KICKED,
      });

      await expect(service.join('session-1', 'user-member')).rejects.toThrow(ForbiddenException);
    });

    it('should throw ConflictException when session is locked', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({ ...mockSession, isLocked: true });
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue(null);

      await expect(service.join('session-1', 'user-member')).rejects.toThrow(ConflictException);
    });

    it('should join a password-protected session with the correct password', async () => {
      const hashed = await bcrypt.hash('secret', 10);
      mockPrisma.session.findUnique.mockResolvedValue({ ...mockSession, password: hashed });
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue(null);
      mockPrisma.sessionParticipant.create.mockResolvedValue(memberParticipant);
      mockPrisma.sessionLog.create.mockResolvedValue({});

      const result = await service.join('session-1', 'user-member', 'secret');

      expect(result.message).toBe('Joined session successfully');
    });

    it('should throw BadRequestException when password is missing for a protected session', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        ...mockSession,
        password: '$2b$10$hashed',
      });
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue(null);

      await expect(service.join('session-1', 'user-member')).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException on wrong password', async () => {
      const hashed = await bcrypt.hash('correct', 10);
      mockPrisma.session.findUnique.mockResolvedValue({ ...mockSession, password: hashed });
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue(null);

      await expect(service.join('session-1', 'user-member', 'wrong')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow a LEFT user to rejoin', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue({
        ...memberParticipant,
        status: ParticipantStatus.LEFT,
      });
      mockPrisma.sessionParticipant.update.mockResolvedValue(memberParticipant);
      mockPrisma.sessionLog.create.mockResolvedValue({});

      const result = await service.join('session-1', 'user-member');

      expect(mockPrisma.sessionParticipant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ParticipantStatus.ACTIVE }),
        }),
      );
      expect(result.message).toBe('Joined session successfully');
    });

    it('should throw ConflictException when session is ENDED', async () => {
      mockPrisma.session.findUnique.mockResolvedValue({
        ...mockSession,
        status: SessionStatus.ENDED,
      });
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue(null);

      await expect(service.join('session-1', 'user-member')).rejects.toThrow(ConflictException);
    });
  });

  // ── leave ────────────────────────────────────────────────────────────────

  describe('leave', () => {
    it('should mark participant as LEFT', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(activeSession);
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue(memberParticipant);
      mockPrisma.sessionParticipant.update.mockResolvedValue({
        ...memberParticipant,
        status: ParticipantStatus.LEFT,
      });
      mockPrisma.sessionLog.create.mockResolvedValue({});

      const result = await service.leave('session-1', 'user-member');

      expect(mockPrisma.sessionParticipant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ParticipantStatus.LEFT,
            leftAt: expect.any(Date),
          }),
        }),
      );
      expect(mockPrisma.sessionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ eventType: SessionEventType.USER_LEFT }),
      });
      expect(result.message).toBe('Left session successfully');
    });

    it('should throw BadRequestException when host tries to leave', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(activeSession);

      await expect(service.leave('session-1', 'user-host')).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when user is not an active participant', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(activeSession);
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue(null);

      await expect(service.leave('session-1', 'user-member')).rejects.toThrow(ConflictException);
    });
  });

  // ── getParticipants ───────────────────────────────────────────────────────

  describe('getParticipants', () => {
    it('should return participants with user details', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);
      mockPrisma.sessionParticipant.findMany.mockResolvedValue([
        { ...hostParticipant, user: { id: 'user-host', username: 'host' } },
      ]);

      const result = await service.getParticipants('session-1');

      expect(mockPrisma.sessionParticipant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sessionId: 'session-1' } }),
      );
      expect(result).toHaveLength(1);
    });

    it('should throw NotFoundException when session does not exist', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);

      await expect(service.getParticipants('bad')).rejects.toThrow(NotFoundException);
    });
  });

  // ── kickParticipant ───────────────────────────────────────────────────────

  describe('kickParticipant', () => {
    it('should kick an active participant and log the event', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(activeSession);
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue(memberParticipant);
      mockPrisma.sessionParticipant.update.mockResolvedValue({
        ...memberParticipant,
        status: ParticipantStatus.KICKED,
      });
      mockPrisma.sessionLog.create.mockResolvedValue({});

      const result = await service.kickParticipant('session-1', 'user-host', 'user-member');

      expect(mockPrisma.sessionParticipant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ParticipantStatus.KICKED }),
        }),
      );
      expect(mockPrisma.sessionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: SessionEventType.USER_KICKED,
          metadata: { kickedBy: 'user-host' },
        }),
      });
      expect(result.message).toBe('Participant removed from session');
    });

    it('should throw ForbiddenException when caller is not the host', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(activeSession);

      await expect(
        service.kickParticipant('session-1', 'user-other', 'user-member'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when host tries to kick themselves', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(activeSession);

      await expect(
        service.kickParticipant('session-1', 'user-host', 'user-host'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when participant is not active', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(activeSession);
      mockPrisma.sessionParticipant.findUnique.mockResolvedValue(null);

      await expect(
        service.kickParticipant('session-1', 'user-host', 'user-ghost'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getLogs ───────────────────────────────────────────────────────────────

  describe('getLogs', () => {
    it('should return session logs ordered by createdAt', async () => {
      const logs = [
        { id: 'log-1', sessionId: 'session-1', eventType: SessionEventType.SESSION_STARTED, userId: 'user-host', metadata: null, createdAt: new Date() },
      ];
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);
      mockPrisma.sessionLog.findMany.mockResolvedValue(logs);

      const result = await service.getLogs('session-1');

      expect(mockPrisma.sessionLog.findMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('should throw NotFoundException when session does not exist', async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);

      await expect(service.getLogs('bad')).rejects.toThrow(NotFoundException);
    });
  });
});
