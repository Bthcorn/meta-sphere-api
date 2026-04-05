/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { DefaultEventsMap } from 'socket.io';
import { RoomsService } from '../src/rooms/rooms.service';
import { RoomType } from '../src/generated/prisma/client';

interface UserInfo {
  jwtToken: string;
  userId: string;
}

async function registerUser(
  app: INestApplication<App>,
  username: string,
): Promise<UserInfo> {
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

  return {
    jwtToken: res.body.access_token,
    userId: res.body.user.id,
  };
}

function waitForConnection(
  client: Socket<DefaultEventsMap, DefaultEventsMap>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
}

function waitForEvent<T>(
  client: Socket<DefaultEventsMap, DefaultEventsMap>,
  event: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for event "${event}"`));
    }, 5000);

    client.once(event, (data: T) => {
      clearTimeout(timeout);
      resolve(data);
    });
  });
}

describe('ChatGateway (e2e)', () => {
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

    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    roomsService = moduleFixture.get<RoomsService>(RoomsService);

    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? parseInt(address) : address.port;
    serverUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await prismaService.message.deleteMany({});
    await prismaService.room.deleteMany({});
    await prismaService.user.deleteMany({});
    await app.close();
  });

  describe('chat:send — send a message and broadcast to room', () => {
    it('should deliver a chat message to all joined clients in the room', async () => {
      const sender = await registerUser(app, 'chat_sender1');
      const receiver = await registerUser(app, 'chat_receiver1');

      const room = await roomsService.create(sender.userId, {
        name: 'Chat Room 1',
        type: RoomType.WORKSPACE,
      });

      const senderSocket = io(serverUrl, {
        auth: { token: sender.jwtToken },
        transports: ['websocket'],
      });
      const receiverSocket = io(serverUrl, {
        auth: { token: receiver.jwtToken },
        transports: ['websocket'],
      });

      await Promise.all([
        waitForConnection(senderSocket),
        waitForConnection(receiverSocket),
      ]);

      // Both clients join the chat room
      senderSocket.emit('chat:join', { roomId: room.id });
      receiverSocket.emit('chat:join', { roomId: room.id });

      // Small delay to let join events process
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Receiver listens for the incoming message
      const messagePromise = waitForEvent<{
        id: string;
        content: string;
        roomId: string;
        sender: { id: string; username: string };
      }>(receiverSocket, 'chat:message');

      // Sender emits a message
      senderSocket.emit('chat:send', {
        content: 'Hello, room!',
        roomId: room.id,
      });

      const received = await messagePromise;

      expect(received.content).toBe('Hello, room!');
      expect(received.roomId).toBe(room.id);
      expect(received.sender.id).toBe(sender.userId);
      expect(received.sender.username).toBe('chat_sender1');

      senderSocket.disconnect();
      receiverSocket.disconnect();
    });
  });

  describe('GET /messages/room/:roomId — retrieve message history', () => {
    it('should return persisted messages for a room', async () => {
      const user = await registerUser(app, 'chat_history1');

      const room = await roomsService.create(user.userId, {
        name: 'History Room',
        type: RoomType.WORKSPACE,
      });

      const socket = io(serverUrl, {
        auth: { token: user.jwtToken },
        transports: ['websocket'],
      });

      await waitForConnection(socket);
      socket.emit('chat:join', { roomId: room.id });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send two messages
      const msg1Promise = waitForEvent(socket, 'chat:message');
      socket.emit('chat:send', { content: 'First message', roomId: room.id });
      await msg1Promise;

      const msg2Promise = waitForEvent(socket, 'chat:message');
      socket.emit('chat:send', { content: 'Second message', roomId: room.id });
      await msg2Promise;

      socket.disconnect();

      // Retrieve history via REST
      const historyRes = await request(app.getHttpServer())
        .get(`/api/messages/room/${room.id}`)
        .set('Authorization', `Bearer ${user.jwtToken}`)
        .expect(200);

      expect(Array.isArray(historyRes.body)).toBe(true);
      expect(historyRes.body.length).toBeGreaterThanOrEqual(2);

      const contents = historyRes.body.map(
        (m: { content: string }) => m.content,
      );
      expect(contents).toContain('First message');
      expect(contents).toContain('Second message');

      const firstMsg = historyRes.body[0];
      expect(firstMsg).toHaveProperty('id');
      expect(firstMsg).toHaveProperty('sender');
      expect(firstMsg.sender).toHaveProperty('username');
    });
  });

  describe('chat:typing — broadcast typing indicator', () => {
    it('should forward a typing event to other clients in the room', async () => {
      const userA = await registerUser(app, 'chat_typer1');
      const userB = await registerUser(app, 'chat_watcher1');

      const room = await roomsService.create(userA.userId, {
        name: 'Typing Room',
        type: RoomType.WORKSPACE,
      });

      const socketA = io(serverUrl, {
        auth: { token: userA.jwtToken },
        transports: ['websocket'],
      });
      const socketB = io(serverUrl, {
        auth: { token: userB.jwtToken },
        transports: ['websocket'],
      });

      await Promise.all([
        waitForConnection(socketA),
        waitForConnection(socketB),
      ]);

      // Both join the room
      socketA.emit('chat:join', { roomId: room.id });
      socketB.emit('chat:join', { roomId: room.id });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // socketB listens for typing event
      const typingPromise = waitForEvent<{
        userId: string;
        username: string;
        isTyping: boolean;
      }>(socketB, 'chat:typing');

      // socketA sends typing indicator
      socketA.emit('chat:typing', { roomId: room.id, isTyping: true });

      const typingEvent = await typingPromise;

      expect(typingEvent.userId).toBe(userA.userId);
      expect(typingEvent.username).toBe('chat_typer1');
      expect(typingEvent.isTyping).toBe(true);

      socketA.disconnect();
      socketB.disconnect();
    });

    it('should broadcast isTyping=false when a user stops typing', async () => {
      const userA = await registerUser(app, 'chat_typer2');
      const userB = await registerUser(app, 'chat_watcher2');

      const room = await roomsService.create(userA.userId, {
        name: 'Stop Typing Room',
        type: RoomType.WORKSPACE,
      });

      const socketA = io(serverUrl, {
        auth: { token: userA.jwtToken },
        transports: ['websocket'],
      });
      const socketB = io(serverUrl, {
        auth: { token: userB.jwtToken },
        transports: ['websocket'],
      });

      await Promise.all([
        waitForConnection(socketA),
        waitForConnection(socketB),
      ]);

      socketA.emit('chat:join', { roomId: room.id });
      socketB.emit('chat:join', { roomId: room.id });
      await new Promise((resolve) => setTimeout(resolve, 100));

      const stopTypingPromise = waitForEvent<{ isTyping: boolean }>(
        socketB,
        'chat:typing',
      );

      socketA.emit('chat:typing', { roomId: room.id, isTyping: false });

      const event = await stopTypingPromise;
      expect(event.isTyping).toBe(false);

      socketA.disconnect();
      socketB.disconnect();
    });
  });
});
