import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { App } from 'supertest/types';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { DefaultEventsMap } from 'socket.io';
import { UserStatePayload } from 'src/realtime/user-state';

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
    client.once(event, (data) => {
      resolve(data as T);
    });

    client.once('connect_error', (err) => {
      console.error(`Error while waiting for event "${event}":`, err);
      reject(err);
    });
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
});
