/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { RoomsService } from '../src/rooms/rooms.service';
import { RoomType, SessionType } from '../src/generated/prisma/client';

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n' +
    '0000000052 00000 n \n0000000101 00000 n \n' +
    'trailer\n<</Size 4/Root 1 0 R>>\nstartxref\n160\n%%EOF\n',
);

interface UserInfo {
  jwtToken: string;
  userId: string;
}

function waitForConnection(client: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
}

function waitForEvent<T>(client: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      5000,
    );
    client.once(event, (data: T) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}

describe('Session Files (e2e)', () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let roomsService: RoomsService;
  let serverUrl: string;

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
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? parseInt(address) : address.port;
    serverUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await prismaService.file.deleteMany({});
    await prismaService.sessionParticipant.deleteMany({});
    await prismaService.session.deleteMany({});
    await prismaService.room.deleteMany({});
    await prismaService.user.deleteMany({});
    await app.close();
  });

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

  /** Create room → create session → start it → return sessionId */
  async function setupActiveSession(host: UserInfo): Promise<string> {
    const room = await roomsService.create(host.userId, {
      name: `SF-Room-${Date.now()}`,
      type: RoomType.WORKSPACE,
    });

    const sessionRes = await request(app.getHttpServer())
      .post('/api/sessions')
      .set('Authorization', `Bearer ${host.jwtToken}`)
      .send({ roomId: room.id, title: 'SF Session', type: SessionType.STUDY })
      .expect(201);

    const sessionId = sessionRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${host.jwtToken}`)
      .expect(200);

    return sessionId;
  }

  // ── REST: upload to session tray ────────────────────────────────────────────

  describe('POST /files/upload — session tray', () => {
    it('should upload a file to a session tray for an active participant', async () => {
      const host = await registerUser('sf_upload_host1');
      const participant = await registerUser('sf_upload_part1');
      const sessionId = await setupActiveSession(host);

      // Participant joins the session
      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${participant.jwtToken}`)
        .send({})
        .expect(200);

      const uploadRes = await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${participant.jwtToken}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'shared-doc.pdf',
          contentType: 'application/pdf',
        })
        .field('sessionId', sessionId)
        .expect(201);

      expect(uploadRes.body).toHaveProperty('id');
      expect(uploadRes.body.sessionId).toBe(sessionId);
      expect(uploadRes.body.name).toBe('shared-doc.pdf');
      expect(uploadRes.body.uploadedBy.id).toBe(participant.userId);
    });

    it('should return 403 when a non-participant tries to upload', async () => {
      const host = await registerUser('sf_upload_host2');
      const outsider = await registerUser('sf_upload_out2');
      const sessionId = await setupActiveSession(host);

      await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${outsider.jwtToken}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'intruder.pdf',
          contentType: 'application/pdf',
        })
        .field('sessionId', sessionId)
        .expect(403);
    });
  });

  // ── REST: list session tray files ───────────────────────────────────────────

  describe('GET /files/session/:sessionId — list session tray', () => {
    it('should return files uploaded to the session tray', async () => {
      const host = await registerUser('sf_list_host1');
      const participant = await registerUser('sf_list_part1');
      const sessionId = await setupActiveSession(host);

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${participant.jwtToken}`)
        .send({})
        .expect(200);

      // Upload two files
      await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${participant.jwtToken}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'tray-file-1.pdf',
          contentType: 'application/pdf',
        })
        .field('sessionId', sessionId)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${host.jwtToken}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'tray-file-2.pdf',
          contentType: 'application/pdf',
        })
        .field('sessionId', sessionId)
        .expect(201);

      const listRes = await request(app.getHttpServer())
        .get(`/api/files/session/${sessionId}`)
        .set('Authorization', `Bearer ${participant.jwtToken}`)
        .expect(200);

      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body).toHaveLength(2);

      const names = listRes.body.map((f: { name: string }) => f.name);
      expect(names).toContain('tray-file-1.pdf');
      expect(names).toContain('tray-file-2.pdf');
    });

    it('should return 403 for a non-participant trying to list session files', async () => {
      const host = await registerUser('sf_list_host2');
      const outsider = await registerUser('sf_list_out2');
      const sessionId = await setupActiveSession(host);

      await request(app.getHttpServer())
        .get(`/api/files/session/${sessionId}`)
        .set('Authorization', `Bearer ${outsider.jwtToken}`)
        .expect(403);
    });
  });

  // ── WebSocket: session:file_share broadcast ─────────────────────────────────

  describe('session:file_share — real-time broadcast', () => {
    it('should broadcast session:file_shared to all sockets in the session room', async () => {
      const host = await registerUser('sf_ws_host1');
      const participant = await registerUser('sf_ws_part1');
      const sessionId = await setupActiveSession(host);

      // Participant joins the HTTP session
      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${participant.jwtToken}`)
        .send({})
        .expect(200);

      // Participant uploads a file via REST
      const uploadRes = await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${participant.jwtToken}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'ws-share.pdf',
          contentType: 'application/pdf',
        })
        .field('sessionId', sessionId)
        .expect(201);

      const fileId = uploadRes.body.id;

      // Connect both sockets and join the session socket.io room via chat:join
      const hostSocket = io(serverUrl, {
        auth: { token: host.jwtToken },
        transports: ['websocket'],
      });
      const participantSocket = io(serverUrl, {
        auth: { token: participant.jwtToken },
        transports: ['websocket'],
      });

      await Promise.all([
        waitForConnection(hostSocket),
        waitForConnection(participantSocket),
      ]);

      hostSocket.emit('chat:join', { sessionId });
      participantSocket.emit('chat:join', { sessionId });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Host listens for the broadcast
      const sharedPromise = waitForEvent<{ id: string; sessionId: string }>(
        hostSocket,
        'session:file_shared',
      );

      // Participant (uploader) notifies the gateway about the upload
      participantSocket.emit('session:file_share', { fileId, sessionId });

      const sharedEvent = await sharedPromise;
      expect(sharedEvent.id).toBe(fileId);
      expect(sharedEvent.sessionId).toBe(sessionId);

      hostSocket.disconnect();
      participantSocket.disconnect();
    });
  });

  // ── WebSocket: session:file_remove (host-only) ──────────────────────────────

  describe('session:file_remove — host removes a file from the tray', () => {
    it('should broadcast session:file_removed when the host deletes a file', async () => {
      const host = await registerUser('sf_ws_rmhost1');
      const participant = await registerUser('sf_ws_rmpart1');
      const sessionId = await setupActiveSession(host);

      await request(app.getHttpServer())
        .post(`/api/sessions/${sessionId}/join`)
        .set('Authorization', `Bearer ${participant.jwtToken}`)
        .send({})
        .expect(200);

      // Participant uploads a file
      const uploadRes = await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${participant.jwtToken}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'to-remove.pdf',
          contentType: 'application/pdf',
        })
        .field('sessionId', sessionId)
        .expect(201);

      const fileId = uploadRes.body.id;

      const hostSocket = io(serverUrl, {
        auth: { token: host.jwtToken },
        transports: ['websocket'],
      });
      const participantSocket = io(serverUrl, {
        auth: { token: participant.jwtToken },
        transports: ['websocket'],
      });

      await Promise.all([
        waitForConnection(hostSocket),
        waitForConnection(participantSocket),
      ]);

      hostSocket.emit('chat:join', { sessionId });
      participantSocket.emit('chat:join', { sessionId });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Participant listens for the removal broadcast
      const removedPromise = waitForEvent<{ fileId: string }>(
        participantSocket,
        'session:file_removed',
      );

      // Host removes the file
      hostSocket.emit('session:file_remove', { fileId, sessionId });

      const removedEvent = await removedPromise;
      expect(removedEvent.fileId).toBe(fileId);

      hostSocket.disconnect();
      participantSocket.disconnect();
    });
  });
});
