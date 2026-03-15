import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { App } from 'supertest/types';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { DefaultEventsMap } from 'socket.io';
import { UserStatePayload } from 'src/realtime/user-state';
import { RoomsService } from '../src/rooms/rooms.service';
import { SessionsService } from '../src/sessions/sessions.service';
import { RoomType, SessionType } from '../src/generated/prisma/client';

export interface UserInfo {
  jwtToken: string;
  userId: string;
}

export async function registerUser(
  app: INestApplication<App>,
  username: string,
  opts?: Partial<{
    password: string;
    email: string;
    firstName: string;
    lastName: string;
  }>,
): Promise<UserInfo> {
  const password = opts?.password || 'password123';
  const email = opts?.email || `${username}@example.com`;
  const firstName = opts?.firstName || 'Test';
  const lastName = opts?.lastName || 'User';

  const response = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      username,
      password,
      email,
      firstName,
      lastName,
    })
    .expect(201);

  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    jwtToken: response.body.access_token,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    userId: response.body.user.id,
  };
}

function assertConnected(
  client: Socket<DefaultEventsMap, DefaultEventsMap>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('connect', () => {
      resolve();
    });
    client.once('connect_error', (err) => {
      console.error('Connection error:', err);
      reject(err);
    });
  });
}

function assertOnEvent<T>(
  client: Socket<DefaultEventsMap, DefaultEventsMap>,
  event: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const onEvent = (data: T) => {
      client.off('connect_error', onError);
      resolve(data);
    };
    const onError = (err: Error) => {
      client.off(event, onEvent);
      console.error(`Error while waiting for event "${event}":`, err);
      reject(err);
    };

    client.once(event, onEvent);
    client.once('connect_error', onError);
  });
}

describe('RealtimeGateway (e2e)', () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let serverUrl: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api');

    prismaService = moduleFixture.get<PrismaService>(PrismaService);

    await app.listen(0); // Listen on a random available port
    const httpServer = app.getHttpServer();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const addressInfo = httpServer.address();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const port =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      typeof addressInfo === 'string' ? addressInfo : addressInfo.port;

    serverUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // Clean up database after each test
    await prismaService.sessionParticipant.deleteMany({});
    await prismaService.session.deleteMany({});
    await prismaService.room.deleteMany({});
    await prismaService.user.deleteMany({});
  });

  describe('User Connections', () => {
    it('should allow a user to connect and receive current state', async () => {
      const userInfo = await registerUser(app, 'testuser1');
      const client = io(`${serverUrl}?token=${userInfo.jwtToken}`);

      const statePromise = assertOnEvent<UserStatePayload[]>(
        client,
        'current_state',
      );

      await assertConnected(client);

      const state = await statePromise;

      expect(state).toHaveLength(1);
      expect(state[0]).toMatchObject({
        position: { x: 0, y: 0, z: 0 },
        userId: userInfo.userId,
      });

      client.disconnect();
    });

    it('should broadcast new user connections to existing clients', async () => {
      const userInfo1 = await registerUser(app, 'testuser1');
      const userInfo2 = await registerUser(app, 'testuser2');

      const client1 = io(`${serverUrl}?token=${userInfo1.jwtToken}`);

      await assertConnected(client1);

      const userConnectedPromise = assertOnEvent<UserStatePayload>(
        client1,
        'user_connected',
      );

      const client2 = io(`${serverUrl}?token=${userInfo2.jwtToken}`);
      const client2StatePromise = assertOnEvent<UserStatePayload[]>(
        client2,
        'current_state',
      );

      await assertConnected(client2);

      const newUserState = await userConnectedPromise;

      expect(newUserState).toMatchObject({
        position: { x: 0, y: 0, z: 0 },
        userId: userInfo2.userId,
      });

      const client2State = await client2StatePromise;

      expect(client2State).toHaveLength(2);
      expect(client2State).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: userInfo1.userId }),
          expect.objectContaining({ userId: userInfo2.userId }),
        ]),
      );

      client1.disconnect();
      client2.disconnect();
    });
  });

  describe('User Movement', () => {
    it('should allow a user to update their position', async () => {
      const userInfo = await registerUser(app, 'testuser3');
      const client = io(`${serverUrl}?token=${userInfo.jwtToken}`);

      await assertConnected(client);

      client.emit('update_position', { x: 1, y: 2, z: 3 });

      client.disconnect();
    });

    it('should broadcast user movement to other clients', async () => {
      const userInfo1 = await registerUser(app, 'testuser4');
      const userInfo2 = await registerUser(app, 'testuser5');
      const userInfo3 = await registerUser(app, 'testuser6');

      const client1 = io(`${serverUrl}?token=${userInfo1.jwtToken}`);
      const client2 = io(`${serverUrl}?token=${userInfo2.jwtToken}`);
      const client3 = io(`${serverUrl}?token=${userInfo3.jwtToken}`);

      await assertConnected(client1);
      await assertConnected(client2);
      await assertConnected(client3);

      const user1MovedPromiseFrom2 = assertOnEvent<UserStatePayload>(
        client2,
        'user_moved',
      );
      const user1MovedPromiseFrom3 = assertOnEvent<UserStatePayload>(
        client3,
        'user_moved',
      );

      // wait for 1 second to ensure the update is not rate-limited
      await new Promise((resolve) => setTimeout(resolve, 1000));

      client1.emit('update_position', { x: 5, y: 6, z: 7 });

      const movedState = await user1MovedPromiseFrom2;

      expect(movedState).toMatchObject({
        position: { x: 5, y: 6, z: 7 },
        userId: userInfo1.userId,
      });

      const movedStateFrom3 = await user1MovedPromiseFrom3;

      expect(movedStateFrom3).toMatchObject({
        position: { x: 5, y: 6, z: 7 },
        userId: userInfo1.userId,
      });

      client1.disconnect();
      client2.disconnect();
      client3.disconnect();
    });

    it('should isolate rooms (client in different rooms will not receive updates)', async () => {
      const userInfo1 = await registerUser(app, 'isolate_user1');
      const userInfo2 = await registerUser(app, 'isolate_user2');
      const userInfo3 = await registerUser(app, 'isolate_user3');

      const roomsService = app.get(RoomsService);
      const sessionsService = app.get(SessionsService);

      // Create a room and active session for user1 and user2
      const room = await roomsService.create(userInfo1.userId, {
        name: 'Test Room',
        type: RoomType.WORKSPACE,
      });

      const session = await sessionsService.create(userInfo1.userId, {
        roomId: room.id,
        title: 'Test Session',
        type: SessionType.MEETING,
      });

      // Start the session
      await sessionsService.start(session.id, userInfo1.userId);

      // Join user2
      await sessionsService.join(session.id, userInfo2.userId);

      // user3 remains in COMMON_AREA_ID (no session)

      const client1 = io(`${serverUrl}?token=${userInfo1.jwtToken}`);
      const client2 = io(`${serverUrl}?token=${userInfo2.jwtToken}`);
      const client3 = io(`${serverUrl}?token=${userInfo3.jwtToken}`);

      await assertConnected(client1);
      await assertConnected(client2);
      await assertConnected(client3);

      const user1MovedPromiseFrom2 = assertOnEvent<UserStatePayload>(
        client2,
        'user_moved',
      );
      const user3MovedHandler = jest.fn();
      client3.on('user_moved', user3MovedHandler);

      // wait for 1 second to ensure the update is not rate-limited
      await new Promise((resolve) => setTimeout(resolve, 1000));

      client1.emit('update_position', { x: 10, y: 20, z: 30 });

      const movedState = await user1MovedPromiseFrom2;

      expect(movedState).toMatchObject({
        position: { x: 10, y: 20, z: 30 },
        userId: userInfo1.userId,
      });

      // Give it extra time to ensure spurious event not fired on client3
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(user3MovedHandler).not.toHaveBeenCalled();

      client1.disconnect();
      client2.disconnect();
      client3.disconnect();
    });
  });

  describe('Dynamic Room Joining and Leaving', () => {
    it('should change room when session.joined and session.left events are processed', async () => {
      const userInfo1 = await registerUser(app, 'dynamic_user1');
      const userInfo2 = await registerUser(app, 'dynamic_user2');

      const roomsService = app.get(RoomsService);
      const sessionsService = app.get(SessionsService);

      // User 1 creates the session environment
      const room = await roomsService.create(userInfo1.userId, {
        name: 'Dynamic Room',
        type: RoomType.WORKSPACE,
      });

      const session = await sessionsService.create(userInfo1.userId, {
        roomId: room.id,
        title: 'Dynamic Session',
        type: SessionType.MEETING,
      });

      await sessionsService.start(session.id, userInfo1.userId);

      // Now both connect.
      // user1 -> in session (created & started it, getActiveUserSession returns it)
      // user2 -> in COMMON_AREA_ID (hasn't joined the session yet)
      const client1 = io(`${serverUrl}?token=${userInfo1.jwtToken}`);
      const client2 = io(`${serverUrl}?token=${userInfo2.jwtToken}`);

      await assertConnected(client1);
      await assertConnected(client2);

      // Wait a moment for initial connections to settle to avoid confusing initial state events with room switching events
      await new Promise((resolve) => setTimeout(resolve, 500));

      const user2JoinedNewRoomPromise = assertOnEvent<UserStatePayload>(
        client1,
        'user_connected',
      );
      const user2CurrentStateNewRoomPromise = assertOnEvent<UserStatePayload[]>(
        client2,
        'current_state',
      );

      // User 2 joins the active session dynamically!
      // This will trigger 'session.joined' event for user2.
      await sessionsService.join(session.id, userInfo2.userId);

      // Client 1 (who is in the session) should see user 2 connect
      const newlyConnectedUser = await user2JoinedNewRoomPromise;
      expect(newlyConnectedUser.userId).toBe(userInfo2.userId);

      // Client 2 should receive the whole room state for the new session
      const newStateForUser2 = await user2CurrentStateNewRoomPromise;
      // It should include user1 and user2
      expect(newStateForUser2).toHaveLength(2);
      expect(newStateForUser2.some((u) => u.userId === userInfo1.userId)).toBe(
        true,
      );
      expect(newStateForUser2.some((u) => u.userId === userInfo2.userId)).toBe(
        true,
      );

      // Now User 2 leaves the session dynamically!
      // This will trigger 'session.left' event for user2.
      const user2DisconnectedFromSessionPromise = assertOnEvent<string>(
        client1,
        'user_disconnected',
      );
      const user2CurrentStateCommonRoomPromise = assertOnEvent<
        UserStatePayload[]
      >(client2, 'current_state');

      await sessionsService.leave(session.id, userInfo2.userId);

      // Client 1 should see user 2 disconnect from the session
      const userLeftSessionId = await user2DisconnectedFromSessionPromise;
      expect(userLeftSessionId).toBe(userInfo2.userId);

      // Client 2 should receive the state of COMMON_AREA_ID again
      const finalStateForUser2 = await user2CurrentStateCommonRoomPromise;
      // Should definitely include user2, but no longer user1
      expect(
        finalStateForUser2.find((u) => u.userId === userInfo1.userId),
      ).toBeUndefined();
      expect(
        finalStateForUser2.find((u) => u.userId === userInfo2.userId),
      ).toBeDefined();

      client1.disconnect();
      client2.disconnect();
    });
  });
});
