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

interface UserInfo {
  jwtToken: string;
  userId: string;
}

interface StrokePayload {
  id: string;
  type: 'pen' | 'eraser' | 'shape' | 'code' | 'arrow';
  points: number[];
  color: string;
  width: number;
  userId: string;
  timestamp: number;
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

function makeStroke(userId: string, id = `stroke-${Date.now()}`): StrokePayload {
  return {
    id,
    type: 'pen',
    points: [0, 0, 10, 10, 20, 5],
    color: '#ff0000',
    width: 2,
    userId,
    timestamp: Date.now(),
  };
}

describe('WhiteboardGateway (e2e)', () => {
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

  async function createSessionId(host: UserInfo): Promise<string> {
    const room = await roomsService.create(host.userId, {
      name: `WB-Room-${Date.now()}`,
      type: RoomType.WORKSPACE,
    });

    const sessionRes = await request(app.getHttpServer())
      .post('/api/sessions')
      .set('Authorization', `Bearer ${host.jwtToken}`)
      .send({ roomId: room.id, title: 'WB Session', type: SessionType.STUDY })
      .expect(201);

    return sessionRes.body.id;
  }

  // ── whiteboard:join → whiteboard:init ───────────────────────────────────────

  describe('whiteboard:join', () => {
    it('should receive whiteboard:init with an empty strokes array on first join', async () => {
      const user = await registerUser('wb_join1');
      const sessionId = await createSessionId(user);

      const socket = io(serverUrl, {
        auth: { token: user.jwtToken },
        transports: ['websocket'],
      });
      await waitForConnection(socket);

      const initPromise = waitForEvent<{ strokes: StrokePayload[] }>(
        socket,
        'whiteboard:init',
      );

      socket.emit('whiteboard:join', { sessionId });

      const init = await initPromise;
      expect(init).toHaveProperty('strokes');
      expect(Array.isArray(init.strokes)).toBe(true);
      expect(init.strokes).toHaveLength(0);

      socket.disconnect();
    });
  });

  // ── whiteboard:stroke → persisted + relayed ─────────────────────────────────

  describe('whiteboard:stroke', () => {
    it('should relay a completed stroke to other clients in the session', async () => {
      const userA = await registerUser('wb_stroke_a');
      const userB = await registerUser('wb_stroke_b');
      const sessionId = await createSessionId(userA);

      const socketA = io(serverUrl, {
        auth: { token: userA.jwtToken },
        transports: ['websocket'],
      });
      const socketB = io(serverUrl, {
        auth: { token: userB.jwtToken },
        transports: ['websocket'],
      });

      await Promise.all([waitForConnection(socketA), waitForConnection(socketB)]);

      // Both join the whiteboard room
      const initA = waitForEvent(socketA, 'whiteboard:init');
      const initB = waitForEvent(socketB, 'whiteboard:init');
      socketA.emit('whiteboard:join', { sessionId });
      socketB.emit('whiteboard:join', { sessionId });
      await Promise.all([initA, initB]);

      // B listens for the stroke from A
      const strokePromise = waitForEvent<StrokePayload>(socketB, 'whiteboard:stroke');

      const stroke = makeStroke(userA.userId, 'stroke-abc');
      socketA.emit('whiteboard:stroke', { sessionId, stroke });

      const received = await strokePromise;
      expect(received.id).toBe('stroke-abc');
      expect(received.color).toBe('#ff0000');
      expect(received.type).toBe('pen');

      socketA.disconnect();
      socketB.disconnect();
    });

    it('should persist the stroke so late-joining clients receive it in whiteboard:init', async () => {
      const userA = await registerUser('wb_persist_a');
      const userC = await registerUser('wb_persist_c');
      const sessionId = await createSessionId(userA);

      const socketA = io(serverUrl, {
        auth: { token: userA.jwtToken },
        transports: ['websocket'],
      });
      await waitForConnection(socketA);

      const initA = waitForEvent(socketA, 'whiteboard:init');
      socketA.emit('whiteboard:join', { sessionId });
      await initA;

      // A sends a stroke
      const stroke = makeStroke(userA.userId, 'stroke-persist');
      socketA.emit('whiteboard:stroke', { sessionId, stroke });

      // Wait briefly for Redis persistence
      await new Promise((resolve) => setTimeout(resolve, 150));

      // C joins later — should receive the stroke in history
      const socketC = io(serverUrl, {
        auth: { token: userC.jwtToken },
        transports: ['websocket'],
      });
      await waitForConnection(socketC);

      const initPromise = waitForEvent<{ strokes: StrokePayload[] }>(
        socketC,
        'whiteboard:init',
      );
      socketC.emit('whiteboard:join', { sessionId });

      const init = await initPromise;
      expect(init.strokes.length).toBeGreaterThanOrEqual(1);
      const found = init.strokes.find((s) => s.id === 'stroke-persist');
      expect(found).toBeDefined();

      socketA.disconnect();
      socketC.disconnect();
    });
  });

  // ── whiteboard:undo ─────────────────────────────────────────────────────────

  describe('whiteboard:undo', () => {
    it('should relay undo to other clients and remove stroke from history', async () => {
      const userA = await registerUser('wb_undo_a');
      const userB = await registerUser('wb_undo_b');
      const userC = await registerUser('wb_undo_c');
      const sessionId = await createSessionId(userA);

      const socketA = io(serverUrl, {
        auth: { token: userA.jwtToken },
        transports: ['websocket'],
      });
      const socketB = io(serverUrl, {
        auth: { token: userB.jwtToken },
        transports: ['websocket'],
      });

      await Promise.all([waitForConnection(socketA), waitForConnection(socketB)]);

      const initA = waitForEvent(socketA, 'whiteboard:init');
      const initB = waitForEvent(socketB, 'whiteboard:init');
      socketA.emit('whiteboard:join', { sessionId });
      socketB.emit('whiteboard:join', { sessionId });
      await Promise.all([initA, initB]);

      // Persist a stroke
      const strokeId = `stroke-undo-${Date.now()}`;
      const stroke = makeStroke(userA.userId, strokeId);
      socketA.emit('whiteboard:stroke', { sessionId, stroke });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // B listens for the undo relay
      const undoPromise = waitForEvent<{ strokeId: string }>(
        socketB,
        'whiteboard:undo',
      );

      socketA.emit('whiteboard:undo', { sessionId, strokeId });

      const undoEvent = await undoPromise;
      expect(undoEvent.strokeId).toBe(strokeId);

      // C joins after undo — stroke should no longer be in history
      const socketC = io(serverUrl, {
        auth: { token: userC.jwtToken },
        transports: ['websocket'],
      });
      await waitForConnection(socketC);

      const initPromise = waitForEvent<{ strokes: StrokePayload[] }>(
        socketC,
        'whiteboard:init',
      );
      socketC.emit('whiteboard:join', { sessionId });

      const init = await initPromise;
      const stillPresent = init.strokes.find((s) => s.id === strokeId);
      expect(stillPresent).toBeUndefined();

      socketA.disconnect();
      socketB.disconnect();
      socketC.disconnect();
    });
  });

  // ── whiteboard:clear ────────────────────────────────────────────────────────

  describe('whiteboard:clear', () => {
    it('should relay clear to other clients and wipe all strokes from history', async () => {
      const userA = await registerUser('wb_clear_a');
      const userB = await registerUser('wb_clear_b');
      const userC = await registerUser('wb_clear_c');
      const sessionId = await createSessionId(userA);

      const socketA = io(serverUrl, {
        auth: { token: userA.jwtToken },
        transports: ['websocket'],
      });
      const socketB = io(serverUrl, {
        auth: { token: userB.jwtToken },
        transports: ['websocket'],
      });

      await Promise.all([waitForConnection(socketA), waitForConnection(socketB)]);

      const initA = waitForEvent(socketA, 'whiteboard:init');
      const initB = waitForEvent(socketB, 'whiteboard:init');
      socketA.emit('whiteboard:join', { sessionId });
      socketB.emit('whiteboard:join', { sessionId });
      await Promise.all([initA, initB]);

      // Add a couple of strokes
      socketA.emit('whiteboard:stroke', {
        sessionId,
        stroke: makeStroke(userA.userId, 'stroke-clr-1'),
      });
      socketA.emit('whiteboard:stroke', {
        sessionId,
        stroke: makeStroke(userA.userId, 'stroke-clr-2'),
      });
      await new Promise((resolve) => setTimeout(resolve, 150));

      // B listens for the clear event
      const clearPromise = waitForEvent(socketB, 'whiteboard:clear');

      socketA.emit('whiteboard:clear', { sessionId });

      await clearPromise; // event received by B

      // C joins after clear — history should be empty
      const socketC = io(serverUrl, {
        auth: { token: userC.jwtToken },
        transports: ['websocket'],
      });
      await waitForConnection(socketC);

      const initPromise = waitForEvent<{ strokes: StrokePayload[] }>(
        socketC,
        'whiteboard:init',
      );
      socketC.emit('whiteboard:join', { sessionId });

      const init = await initPromise;
      expect(init.strokes).toHaveLength(0);

      socketA.disconnect();
      socketB.disconnect();
      socketC.disconnect();
    });
  });
});
