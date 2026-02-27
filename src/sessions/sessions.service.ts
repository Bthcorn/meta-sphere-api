import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  SessionStatus,
  SessionEventType,
  ParticipantRole,
  ParticipantStatus,
  Prisma,
} from 'src/generated/prisma/client';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { ListSessionsDto } from './dto/list-sessions.dto';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Internal helpers ──────────────────────────────────────────────────

  private async getSession(id: string) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  private assertHost(session: { hostId: string }, userId: string) {
    if (session.hostId !== userId) {
      throw new ForbiddenException('Only the session host can perform this action');
    }
  }

  private stripPassword<T extends { password?: string | null }>(
    obj: T,
  ): Omit<T, 'password'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...rest } = obj;
    return rest;
  }

  private async writeLog(
    sessionId: string,
    eventType: SessionEventType,
    userId?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await this.prisma.sessionLog.create({
      data: { sessionId, eventType, userId, metadata },
    });
  }

  // ── Public API ────────────────────────────────────────────────────────

  async findAll(query: ListSessionsDto) {
    const sessions = await this.prisma.session.findMany({
      where: {
        ...(query.roomId && { roomId: query.roomId }),
        ...(query.status && { status: query.status }),
      },
      include: {
        _count: { select: { sessionParticipants: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map(this.stripPassword.bind(this));
  }

  async create(hostId: string, dto: CreateSessionDto) {
    const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
    if (!room || !room.isActive) throw new NotFoundException('Room not found');

    const hashedPassword = dto.password
      ? await bcrypt.hash(dto.password, 10)
      : null;

    const session = await this.prisma.session.create({
      data: {
        roomId: dto.roomId,
        hostId,
        title: dto.title,
        description: dto.description,
        type: dto.type,
        scheduledStartTime: dto.scheduledStartTime
          ? new Date(dto.scheduledStartTime)
          : null,
        password: hashedPassword,
      },
      include: { _count: { select: { sessionParticipants: true } } },
    });

    // Auto-enroll host as HOST participant
    await this.prisma.sessionParticipant.create({
      data: {
        sessionId: session.id,
        userId: hostId,
        role: ParticipantRole.HOST,
      },
    });

    return this.stripPassword(session);
  }

  async findById(id: string) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: { _count: { select: { sessionParticipants: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');
    return this.stripPassword(session);
  }

  async update(id: string, userId: string, dto: UpdateSessionDto) {
    const session = await this.getSession(id);
    this.assertHost(session, userId);

    if (
      session.status === SessionStatus.ENDED ||
      session.status === SessionStatus.CANCELLED
    ) {
      throw new BadRequestException('Cannot update a finished session');
    }

    const updated = await this.prisma.session.update({
      where: { id },
      data: dto,
      include: { _count: { select: { sessionParticipants: true } } },
    });

    if (dto.isLocked !== undefined && dto.isLocked !== session.isLocked) {
      await this.writeLog(
        id,
        dto.isLocked ? SessionEventType.SESSION_LOCKED : SessionEventType.SESSION_UNLOCKED,
        userId,
      );
    }

    return this.stripPassword(updated);
  }

  async start(id: string, userId: string) {
    const session = await this.getSession(id);
    this.assertHost(session, userId);

    if (session.status !== SessionStatus.SCHEDULED) {
      throw new ConflictException(
        `Session cannot be started from status: ${session.status}`,
      );
    }

    const updated = await this.prisma.session.update({
      where: { id },
      data: { status: SessionStatus.ACTIVE, actualStartTime: new Date() },
      include: { _count: { select: { sessionParticipants: true } } },
    });

    await this.writeLog(id, SessionEventType.SESSION_STARTED, userId);
    return this.stripPassword(updated);
  }

  async end(id: string, userId: string) {
    const session = await this.getSession(id);
    this.assertHost(session, userId);

    if (session.status !== SessionStatus.ACTIVE) {
      throw new ConflictException(
        `Session cannot be ended from status: ${session.status}`,
      );
    }

    const now = new Date();

    // Close out all still-active participants
    await this.prisma.sessionParticipant.updateMany({
      where: { sessionId: id, status: ParticipantStatus.ACTIVE },
      data: { status: ParticipantStatus.LEFT, leftAt: now },
    });

    const updated = await this.prisma.session.update({
      where: { id },
      data: { status: SessionStatus.ENDED, actualEndTime: now },
      include: { _count: { select: { sessionParticipants: true } } },
    });

    await this.writeLog(id, SessionEventType.SESSION_ENDED, userId);
    return this.stripPassword(updated);
  }

  async join(id: string, userId: string, password?: string) {
    const session = await this.getSession(id);

    if (
      session.status !== SessionStatus.SCHEDULED &&
      session.status !== SessionStatus.ACTIVE
    ) {
      throw new ConflictException('Session is no longer open for joining');
    }

    const existing = await this.prisma.sessionParticipant.findUnique({
      where: { sessionId_userId: { sessionId: id, userId } },
    });

    if (existing?.status === ParticipantStatus.ACTIVE) {
      return { message: 'Already in session' };
    }

    if (existing?.status === ParticipantStatus.KICKED) {
      throw new ForbiddenException('You have been removed from this session');
    }

    if (session.isLocked) {
      throw new ConflictException('Session is locked — no new participants can join');
    }

    if (session.password) {
      if (!password) {
        throw new BadRequestException('This session requires a password');
      }
      if (!(await bcrypt.compare(password, session.password))) {
        throw new ForbiddenException('Incorrect session password');
      }
    }

    if (existing) {
      // Was LEFT — rejoin
      await this.prisma.sessionParticipant.update({
        where: { sessionId_userId: { sessionId: id, userId } },
        data: {
          status: ParticipantStatus.ACTIVE,
          joinedAt: new Date(),
          leftAt: null,
        },
      });
    } else {
      await this.prisma.sessionParticipant.create({
        data: { sessionId: id, userId, role: ParticipantRole.PARTICIPANT },
      });
    }

    await this.writeLog(id, SessionEventType.USER_JOINED, userId);
    return { message: 'Joined session successfully' };
  }

  async leave(id: string, userId: string) {
    const session = await this.getSession(id);

    if (session.hostId === userId) {
      throw new BadRequestException(
        'Host cannot leave — end the session instead',
      );
    }

    const participant = await this.prisma.sessionParticipant.findUnique({
      where: { sessionId_userId: { sessionId: id, userId } },
    });

    if (!participant || participant.status !== ParticipantStatus.ACTIVE) {
      throw new ConflictException('You are not an active participant in this session');
    }

    await this.prisma.sessionParticipant.update({
      where: { sessionId_userId: { sessionId: id, userId } },
      data: { status: ParticipantStatus.LEFT, leftAt: new Date() },
    });

    await this.writeLog(id, SessionEventType.USER_LEFT, userId);
    return { message: 'Left session successfully' };
  }

  async getParticipants(id: string) {
    await this.getSession(id);

    return this.prisma.sessionParticipant.findMany({
      where: { sessionId: id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
            avatarPreset: true,
            status: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async kickParticipant(id: string, hostId: string, targetUserId: string) {
    const session = await this.getSession(id);
    this.assertHost(session, hostId);

    if (targetUserId === hostId) {
      throw new BadRequestException('Host cannot kick themselves');
    }

    const participant = await this.prisma.sessionParticipant.findUnique({
      where: { sessionId_userId: { sessionId: id, userId: targetUserId } },
    });

    if (!participant || participant.status !== ParticipantStatus.ACTIVE) {
      throw new NotFoundException('Participant is not active in this session');
    }

    await this.prisma.sessionParticipant.update({
      where: { sessionId_userId: { sessionId: id, userId: targetUserId } },
      data: { status: ParticipantStatus.KICKED, leftAt: new Date() },
    });

    await this.writeLog(id, SessionEventType.USER_KICKED, targetUserId, {
      kickedBy: hostId,
    });

    return { message: 'Participant removed from session' };
  }

  async getLogs(id: string) {
    await this.getSession(id);

    return this.prisma.sessionLog.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
    });
  }
}
