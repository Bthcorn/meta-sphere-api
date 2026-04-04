import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SessionStatus,
  SessionEventType,
  SessionType,
  ParticipantRole,
  ParticipantStatus,
  Prisma,
} from 'src/generated/prisma/client';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { ListSessionsDto } from './dto/list-sessions.dto';
import { LiveKitService } from 'src/livekit/livekit.service';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly liveKit: LiveKitService,
    private readonly jwtService: JwtService,
  ) {}

  // ── Internal helpers ──────────────────────────────────────────────────

  private async getSession(id: string) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  private assertHost(session: { hostId: string }, userId: string) {
    if (session.hostId !== userId) {
      throw new ForbiddenException(
        'Only the session host can perform this action',
      );
    }
  }

  private stripPassword<T extends { password?: string | null }>(session: T) {
    const { password, ...rest } = session;
    return { ...rest, hasPassword: !!password };
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
    const room = await this.prisma.room.findUnique({
      where: { id: dto.roomId },
    });
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

    this.eventEmitter.emit('session.joined', {
      userId: hostId,
      sessionId: session.id,
    });

    // Emit invitation event if friends were invited
    if (dto.invitedFriendsIds && dto.invitedFriendsIds.length > 0) {
      this.eventEmitter.emit('session.invite_friends', {
        sessionId: session.id,
        roomId: session.roomId,
        hostId,
        invitedFriendsIds: dto.invitedFriendsIds,
        sessionTitle: session.title,
        sessionType: session.type,
      });
    }

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
        dto.isLocked
          ? SessionEventType.SESSION_LOCKED
          : SessionEventType.SESSION_UNLOCKED,
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

    // Attempt to terminate the active LiveKit room
    await this.liveKit.deleteRoom(id);

    this.eventEmitter.emit('session.ended', { sessionId: id });
    return this.stripPassword(updated);
  }

  async join(
    id: string,
    userId: string,
    password?: string,
    inviteToken?: string,
  ) {
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
      this.eventEmitter.emit('session.joined', { userId, sessionId: id });
      return { message: 'Already in session' };
    }

    if (existing?.status === ParticipantStatus.KICKED) {
      throw new ForbiddenException('You have been removed from this session');
    }

    if (session.isLocked) {
      throw new ConflictException(
        'Session is locked — no new participants can join',
      );
    }

    let isTokenValid = false;
    if (inviteToken) {
      try {
        const payload = this.jwtService.verify<{
          sessionId: string;
          invitedUserId: string;
        }>(inviteToken);

        if (payload.sessionId === id && payload.invitedUserId === userId) {
          isTokenValid = true;
        } else {
          throw new ForbiddenException(
            'Invalid invitation token for this session or user',
          );
        }
      } catch (err) {
        if (err instanceof ForbiddenException) {
          throw err;
        }
        throw new ForbiddenException('Invalid or expired invitation token');
      }
    }

    if (session.password && !isTokenValid) {
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
    this.eventEmitter.emit('session.joined', { userId, sessionId: id });
    return { message: 'Joined session successfully' };
  }

  async leave(id: string, userId: string) {
    const session = await this.getSession(id);

    if (session.hostId === userId) {
      throw new BadRequestException(
        'Host cannot leave — end the session instead',
      );
    }

    if (
      session.status === SessionStatus.ENDED ||
      session.status === SessionStatus.CANCELLED
    ) {
      return { message: 'Session has already ended' };
    }

    const participant = await this.prisma.sessionParticipant.findUnique({
      where: { sessionId_userId: { sessionId: id, userId } },
    });

    if (!participant || participant.status !== ParticipantStatus.ACTIVE) {
      throw new ConflictException(
        'You are not an active participant in this session',
      );
    }

    await this.prisma.sessionParticipant.update({
      where: { sessionId_userId: { sessionId: id, userId } },
      data: { status: ParticipantStatus.LEFT, leftAt: new Date() },
    });

    await this.writeLog(id, SessionEventType.USER_LEFT, userId);
    this.eventEmitter.emit('session.left', { userId });
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
    this.eventEmitter.emit('session.left', { userId: targetUserId });

    return { message: 'Participant removed from session' };
  }

  async getLogs(id: string) {
    await this.getSession(id);

    return this.prisma.sessionLog.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getActiveUserSession(userId: string) {
    const activeParticipation = await this.prisma.sessionParticipant.findFirst({
      where: {
        userId,
        status: ParticipantStatus.ACTIVE,
        session: {
          status: SessionStatus.ACTIVE,
        },
      },
      include: {
        session: true,
      },
      orderBy: {
        joinedAt: 'desc',
      },
    });

    if (!activeParticipation) {
      return null;
    }

    return activeParticipation.session;
  }

  async generateVoiceToken(sessionId: string, userId: string) {
    const session = await this.getSession(sessionId);

    // Verify user is an active participant in this session
    const participant = await this.prisma.sessionParticipant.findUnique({
      where: { sessionId_userId: { sessionId, userId } },
      include: { user: true },
    });

    if (!participant || participant.status !== ParticipantStatus.ACTIVE) {
      throw new ForbiddenException(
        'You must be an active participant to join the voice room',
      );
    }

    // Allow voice tokens for both SCHEDULED and ACTIVE sessions so the host
    // can connect to the voice room before the session officially starts.
    if (
      session.status !== SessionStatus.ACTIVE &&
      session.status !== SessionStatus.SCHEDULED
    ) {
      throw new ConflictException('Session is not active or scheduled');
    }

    const isHost = participant.role === ParticipantRole.HOST;
    const canScreenShare = session.type === SessionType.MEETING;
    const displayName =
      `${participant.user.firstName} ${participant.user.lastName}`.trim() ||
      participant.user.username;

    const token = await this.liveKit.createToken(
      userId,
      displayName,
      sessionId,
      isHost,
      canScreenShare,
    );

    const url = this.liveKit.getLiveKitPublicUrl();

    return { token, url };
  }
}
