/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { App } from 'supertest/types';
import { RoomsService } from '../src/rooms/rooms.service';
import { RoomType, SessionType } from '../src/generated/prisma/client';

interface UserInfo {
  jwtToken: string;
  userId: string;
}

describe('SessionsController (e2e)', () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let roomsService: RoomsService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api');

    prismaService = app.get(PrismaService);
    roomsService = app.get(RoomsService);

    await app.init();
  });

  afterAll(async () => {
    await prismaService.sessionLog.deleteMany({});
    await prismaService.sessionParticipant.deleteMany({});
    await prismaService.session.deleteMany({});
    await prismaService.room.deleteMany({});
    await prismaService.user.deleteMany({});
    await app.close();
  });

  // ── Shared helpers ──────────────────────────────────────────────────────────

  async function registerUser(username: string): Promise<UserInfo> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        username,
        password: 'password123',
        email: `${username}@example.com`,
        firstName: 'Test',
        lastName: 'User',
      })
      .expect(201);

    return { jwtToken: res.body.access_token, userId: res.body.user.id };
  }

  async function createRoom(userId: string): Promise<string> {
    const room = await roomsService.create(userId, {
      name: `Room-${Date.now()}`,
      type: RoomType.WORKSPACE,
    });
    return room.id;
  }

  async function createSession(
    hostToken: string,
    roomId: string,
    title: string,
    extra: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      .post('/api/sessions')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({ roomId, title, type: SessionType.STUDY, ...extra })
      .expect(201);
  }

  // ── POST /sessions ──────────────────────────────────────────────────────────

  describe('POST /sessions', () => {
    it('should create a session and auto-enroll the host', async () => {
      const host = await registerUser('sess_create_host');
      const roomId = await createRoom(host.userId);

      const res = await createSession(host.jwtToken, roomId, 'Algo Study');

      expect(res.body).toHaveProperty('id');
      expect(res.body.title).toBe('Algo Study');
      expect(res.body.type).toBe(SessionType.STUDY);
      expect(res.body.hostId).toBe(host.userId);
      expect(res.body).toHaveProperty('hasPassword', false);
      expect(res.body).not.toHaveProperty('password');

      // Host is auto-enrolled — verify via participants endpoint
      const parts = await request(app.getHttpServer())
        .get(`/api/sessions/${res.body.id}/participants`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      expect(parts.body).toHaveLength(1);
      expect(parts.body[0].userId).toBe(host.userId);
      expect(parts.body[0].role).toBe('HOST');
    });

    it('should return 404 when the room does not exist', async () => {
      const host = await registerUser('sess_create_noroom');

      await request(app.getHttpServer())
        .post('/api/sessions')
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .send({
          roomId: '00000000-0000-0000-0000-000000000000',
          title: 'Ghost Session',
          type: SessionType.STUDY,
        })
        .expect(404);
    });

    it('should create a password-protected session', async () => {
      const host = await registerUser('sess_create_pw');
      const roomId = await createRoom(host.userId);

      const res = await createSession(
        host.jwtToken,
        roomId,
        'Secret Session',
        { password: 'pass1234' },
      );

      expect(res.body).toHaveProperty('hasPassword', true);
      expect(res.body).not.toHaveProperty('password');
    });
  });

  // ── GET /sessions ───────────────────────────────────────────────────────────

  describe('GET /sessions', () => {
    it('should list all sessions', async () => {
      const host = await registerUser('sess_list_host');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Listed Session');
      const sessionId = sessionRes.body.id;

      const listRes = await request(app.getHttpServer())
        .get('/api/sessions')
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      expect(Array.isArray(listRes.body)).toBe(true);
      const found = listRes.body.find((s: { id: string }) => s.id === sessionId);
      expect(found).toBeDefined();
      expect(found).not.toHaveProperty('password');
    });

    it('should filter sessions by roomId', async () => {
      const host = await registerUser('sess_list_filter');
      const roomId = await createRoom(host.userId);
      const otherRoomId = await createRoom(host.userId);

      const inRoom = await createSession(host.jwtToken, roomId, 'In Room');
      await createSession(host.jwtToken, otherRoomId, 'Other Room');

      const filtered = await request(app.getHttpServer())
        .get('/api/sessions')
        .query({ roomId })
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      expect(
        filtered.body.every((s: { roomId: string }) => s.roomId === roomId),
      ).toBe(true);
      expect(filtered.body.some((s: { id: string }) => s.id === inRoom.body.id)).toBe(true);
    });
  });

  // ── GET /sessions/:id ───────────────────────────────────────────────────────

  describe('GET /sessions/:id', () => {
    it('should return session details', async () => {
      const host = await registerUser('sess_get_host');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Detail Session');
      const sessionId = sessionRes.body.id;

      const res = await request(app.getHttpServer())
        .get(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      expect(res.body.id).toBe(sessionId);
      expect(res.body.title).toBe('Detail Session');
      expect(res.body).toHaveProperty('hasPassword');
      expect(res.body._count).toHaveProperty('sessionParticipants');
    });

    it('should return 404 for a non-existent session', async () => {
      const host = await registerUser('sess_get_404');

      await request(app.getHttpServer())
        .get('/api/sessions/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(404);
    });
  });

  // ── PATCH /sessions/:id ─────────────────────────────────────────────────────

  describe('PATCH /sessions/:id', () => {
    it('should allow the host to update title and description', async () => {
      const host = await registerUser('sess_patch_host');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Original Title');
      const sessionId = sessionRes.body.id;

      const updated = await request(app.getHttpServer())
        .patch(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .send({ title: 'Updated Title', description: 'New desc' })
        .expect(200);

      expect(updated.body.title).toBe('Updated Title');
      expect(updated.body.description).toBe('New desc');
    });

    it('should return 403 when a non-host tries to update', async () => {
      const host = await registerUser('sess_patch_host2');
      const other = await registerUser('sess_patch_other2');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Protected Session');

      await request(app.getHttpServer())
        .patch(`/api/sessions/${sessionRes.body.id}`)
        .set('Authorization', `Bearer ${other.jwtToken}`)
        .send({ title: 'Hijacked' })
        .expect(403);
    });
  });

  // ── Session lock ────────────────────────────────────────────────────────────

  describe('Session lock (PATCH isLocked)', () => {
    it('should prevent new participants from joining when locked', async () => {
      const host = await registerUser('sess_lock_host');
      const joiner = await registerUser('sess_lock_joiner');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Lockable Session');
      const sessionId = sessionRes.body.id;

      // Lock the session
      const lockRes = await request(app.getHttpServer())
        .patch(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .send({ isLocked: true })
        .expect(200);

      expect(lockRes.body.isLocked).toBe(true);

      // New participant tries to join → 409
      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .send({})
        .expect(409);
    });

    it('should allow joining after unlocking', async () => {
      const host = await registerUser('sess_unlock_host');
      const joiner = await registerUser('sess_unlock_joiner');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Unlockable Session');
      const sessionId = sessionRes.body.id;

      // Lock then unlock
      await request(app.getHttpServer())
        .patch(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .send({ isLocked: true })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .send({ isLocked: false })
        .expect(200);

      // Now join should succeed
      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .send({})
        .expect(200);
    });
  });

  // ── POST /sessions/:id/start ────────────────────────────────────────────────

  describe('POST /sessions/:id/start', () => {
    it('should allow the host to start a SCHEDULED session', async () => {
      const host = await registerUser('sess_start_host');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Startable Session');
      const sessionId = sessionRes.body.id;

      const started = await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      expect(started.body.status).toBe('ACTIVE');
      expect(started.body).toHaveProperty('actualStartTime');
    });

    it('should return 403 when a non-host tries to start', async () => {
      const host = await registerUser('sess_start_nonhost_h');
      const other = await registerUser('sess_start_nonhost_o');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Non-host Start');

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionRes.body.id}/start`)
        .set('Authorization', `Bearer ${other.jwtToken}`)
        .expect(403);
    });

    it('should return 409 when session is already ACTIVE', async () => {
      const host = await registerUser('sess_start_already');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Already Active');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      // Start again → 409
      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(409);
    });
  });

  // ── POST /sessions/:id/join ─────────────────────────────────────────────────

  describe('POST /sessions/:id/join', () => {
    it('should allow a user to join a SCHEDULED session', async () => {
      const host = await registerUser('sess_join_host');
      const joiner = await registerUser('sess_join_user');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Open Session');

      const joinRes = await request(app.getHttpServer())
        .post(`/api/sessions/${sessionRes.body.id}/join`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .send({})
        .expect(200);

      expect(joinRes.body.message).toBe('Joined session successfully');
    });

    it('should allow joining an ACTIVE session', async () => {
      const host = await registerUser('sess_join_active_h');
      const joiner = await registerUser('sess_join_active_j');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Active Join');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      const joinRes = await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .send({})
        .expect(200);

      expect(joinRes.body.message).toBe('Joined session successfully');
    });

    it('should require password for a password-protected session', async () => {
      const host = await registerUser('sess_join_pw_host');
      const joiner = await registerUser('sess_join_pw_user');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(
        host.jwtToken,
        roomId,
        'Secret Session',
        { password: 'open1234' },
      );
      const sessionId = sessionRes.body.id;

      // No password → 400
      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .send({})
        .expect(400);

      // Wrong password → 403
      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .send({ password: 'wrongpass' })
        .expect(403);

      // Correct password → 200
      const ok = await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .send({ password: 'open1234' })
        .expect(200);

      expect(ok.body.message).toBe('Joined session successfully');
    });
  });

  // ── POST /sessions/:id/leave ────────────────────────────────────────────────

  describe('POST /sessions/:id/leave', () => {
    it('should allow an active participant to leave', async () => {
      const host = await registerUser('sess_leave_host');
      const joiner = await registerUser('sess_leave_user');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Leavable Session');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .send({})
        .expect(200);

      const leaveRes = await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/leave`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .expect(200);

      expect(leaveRes.body.message).toBe('Left session successfully');
    });

    it('should return 400 when the host tries to leave instead of ending', async () => {
      const host = await registerUser('sess_leave_host2');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Host Leave');

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionRes.body.id}/leave`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(400);
    });

    it('should return 409 when a non-participant tries to leave', async () => {
      const host = await registerUser('sess_leave_nonpart_h');
      const stranger = await registerUser('sess_leave_nonpart_s');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Non-participant Leave');

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionRes.body.id}/leave`)
        .set('Authorization', `Bearer ${stranger.jwtToken}`)
        .expect(409);
    });
  });

  // ── GET /sessions/:id/participants ──────────────────────────────────────────

  describe('GET /sessions/:id/participants', () => {
    it('should list participants with user details', async () => {
      const host = await registerUser('sess_parts_host');
      const joiner = await registerUser('sess_parts_user');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Participants Test');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .send({})
        .expect(200);

      const partsRes = await request(app.getHttpServer())
        .get(`/api/sessions/${sessionId}/participants`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      expect(Array.isArray(partsRes.body)).toBe(true);
      expect(partsRes.body).toHaveLength(2); // host + joiner

      const ids = partsRes.body.map((p: { userId: string }) => p.userId);
      expect(ids).toContain(host.userId);
      expect(ids).toContain(joiner.userId);

      const hostPart = partsRes.body.find(
        (p: { userId: string }) => p.userId === host.userId,
      );
      expect(hostPart.role).toBe('HOST');
      expect(hostPart).toHaveProperty('user');
      expect(hostPart.user).toHaveProperty('username');
    });
  });

  // ── DELETE /sessions/:id/participants/:userId (kick) ────────────────────────

  describe('DELETE /sessions/:id/participants/:userId', () => {
    it('should allow the host to kick an active participant', async () => {
      const host = await registerUser('sess_kick_host');
      const victim = await registerUser('sess_kick_victim');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Kick Session');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${victim.jwtToken}`)
        .send({})
        .expect(200);

      const kickRes = await request(app.getHttpServer())
        .delete(`/api/sessions/${sessionId}/participants/${victim.userId}`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      expect(kickRes.body.message).toBe('Participant removed from session');
    });

    it('should prevent the kicked user from rejoining', async () => {
      const host = await registerUser('sess_kick_rejoin_h');
      const victim = await registerUser('sess_kick_rejoin_v');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'No Rejoin');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${victim.jwtToken}`)
        .send({})
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/sessions/${sessionId}/participants/${victim.userId}`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      // Victim tries to rejoin → 403
      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${victim.jwtToken}`)
        .send({})
        .expect(403);
    });

    it('should return 400 when the host tries to kick themselves', async () => {
      const host = await registerUser('sess_kick_self_h');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Self Kick');

      await request(app.getHttpServer())
        .delete(`/api/sessions/${sessionRes.body.id}/participants/${host.userId}`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(400);
    });

    it('should return 403 when a non-host tries to kick', async () => {
      const host = await registerUser('sess_kick_403_h');
      const participant = await registerUser('sess_kick_403_p');
      const target = await registerUser('sess_kick_403_t');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Unauthorized Kick');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${participant.jwtToken}`)
        .send({})
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${target.jwtToken}`)
        .send({})
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/sessions/${sessionId}/participants/${target.userId}`)
        .set('Authorization', `Bearer ${participant.jwtToken}`)
        .expect(403);
    });
  });

  // ── POST /sessions/:id/end ─────────────────────────────────────────────────

  describe('POST /sessions/:id/end', () => {
    it('should allow the host to end an ACTIVE session and mark it ENDED', async () => {
      const host = await registerUser('sess_end_host');
      const joiner = await registerUser('sess_end_joiner');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Endable Session');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .send({})
        .expect(200);

      const endRes = await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/end`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      expect(endRes.body.status).toBe('ENDED');
      expect(endRes.body).toHaveProperty('actualEndTime');
    });

    it('should mark all active participants as LEFT when the session ends', async () => {
      const host = await registerUser('sess_end_parts_h');
      const joiner = await registerUser('sess_end_parts_j');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'End Participants');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .send({})
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/end`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      const partsRes = await request(app.getHttpServer())
        .get(`/api/sessions/${sessionId}/participants`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      const statuses = partsRes.body.map((p: { status: string }) => p.status);
      expect(statuses.every((s: string) => s === 'LEFT')).toBe(true);
    });

    it('should write a SESSION_ENDED log entry', async () => {
      const host = await registerUser('sess_end_log_h');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'End Log Session');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/end`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      const logsRes = await request(app.getHttpServer())
        .get(`/api/sessions/${sessionId}/logs`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      const eventTypes = logsRes.body.map((l: { eventType: string }) => l.eventType);
      expect(eventTypes).toContain('SESSION_ENDED');
    });

    it('should return 409 when ending a SCHEDULED (not yet started) session', async () => {
      const host = await registerUser('sess_end_scheduled_h');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Not Started');

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionRes.body.id}/end`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(409);
    });

    it('should return 409 when ending an already ENDED session', async () => {
      const host = await registerUser('sess_end_twice_h');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'End Twice');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/end`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/end`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(409);
    });

    it('should return 403 when a non-host tries to end', async () => {
      const host = await registerUser('sess_end_403_h');
      const other = await registerUser('sess_end_403_o');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Unauthorized End');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/end`)
        .set('Authorization', `Bearer ${other.jwtToken}`)
        .expect(403);
    });

    it('should prevent joining after the session has ended', async () => {
      const host = await registerUser('sess_end_join_h');
      const latecomer = await registerUser('sess_end_join_l');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Closed Session');
      const sessionId = sessionRes.body.id;

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/end`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${latecomer.jwtToken}`)
        .send({})
        .expect(409);
    });
  });

  // ── GET /sessions/:id/logs ──────────────────────────────────────────────────

  describe('GET /sessions/:id/logs', () => {
    it('should return event logs reflecting session lifecycle actions', async () => {
      const host = await registerUser('sess_logs_host');
      const joiner = await registerUser('sess_logs_joiner');
      const roomId = await createRoom(host.userId);
      const sessionRes = await createSession(host.jwtToken, roomId, 'Log Session');
      const sessionId = sessionRes.body.id;

      // Start the session → SESSION_STARTED
      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      // Joiner joins → USER_JOINED
      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${joiner.jwtToken}`)
        .send({})
        .expect(200);

      // Host kicks joiner → USER_KICKED
      await request(app.getHttpServer())
        .delete(`/api/sessions/${sessionId}/participants/${joiner.userId}`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      // Fetch logs
      const logsRes = await request(app.getHttpServer())
        .get(`/api/sessions/${sessionId}/logs`)
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .expect(200);

      expect(Array.isArray(logsRes.body)).toBe(true);
      const eventTypes = logsRes.body.map((l: { eventType: string }) => l.eventType);
      expect(eventTypes).toContain('SESSION_STARTED');
      expect(eventTypes).toContain('USER_JOINED');
      expect(eventTypes).toContain('USER_KICKED');
    });
  });
});
