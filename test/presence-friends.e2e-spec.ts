import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { App } from 'supertest/types';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { DefaultEventsMap } from 'socket.io';

interface UserInfo {
  jwtToken: string;
  userId: string;
}

async function registerUser(
  app: INestApplication<App>,
  username: string,
): Promise<UserInfo> {
  const response = await request(app.getHttpServer())
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
      reject(err);
    });
  });
}

describe('Presence & Online Friends (e2e)', () => {
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
        whitelist: true,
      }),
    );
    app.setGlobalPrefix('api');

    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? address : address.port;
    serverUrl = `http://localhost:${port}`;

    prismaService = app.get(PrismaService);
  });

  afterAll(async () => {
    await prismaService.$disconnect();
    await app.close();
  });

  it('should track user presence via websocket connection', async () => {
    const alice = await registerUser(app, 'alice_presence');
    const bob = await registerUser(app, 'bob_presence');

    // Make them friends
    await request(app.getHttpServer())
      .post(`/api/friends/request/${bob.userId}`)
      .set('Authorization', `Bearer ${alice.jwtToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(
        `/api/friends/accept/${(await prismaService.friendship.findFirst({ where: { requesterId: alice.userId } }))?.id}`,
      )
      .set('Authorization', `Bearer ${bob.jwtToken}`)
      .expect(201);

    // Initially, no one is online
    let response = await request(app.getHttpServer())
      .get('/api/friends/online')
      .set('Authorization', `Bearer ${alice.jwtToken}`)
      .expect(200);

    expect(response.body).toEqual([]);

    // Connect Bob via WebSocket
    const bobSocket = io(serverUrl, {
      auth: { token: bob.jwtToken },
      transports: ['websocket'],
    });

    await assertConnected(bobSocket);

    // Wait a bit for presence event to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Now Bob should appear online for Alice
    response = await request(app.getHttpServer())
      .get('/api/friends/online')
      .set('Authorization', `Bearer ${alice.jwtToken}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body[0].friend.id).toBe(bob.userId);

    // Disconnect Bob
    bobSocket.disconnect();

    // Wait for disconnect event to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Now Bob should be offline
    response = await request(app.getHttpServer())
      .get('/api/friends/online')
      .set('Authorization', `Bearer ${alice.jwtToken}`)
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('should return multiple online friends', async () => {
    const charlie = await registerUser(app, 'charlie_presence');
    const dave = await registerUser(app, 'dave_presence');
    const eve = await registerUser(app, 'eve_presence');

    // Make Charlie friends with Dave and Eve
    await request(app.getHttpServer())
      .post(`/api/friends/request/${dave.userId}`)
      .set('Authorization', `Bearer ${charlie.jwtToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/friends/request/${eve.userId}`)
      .set('Authorization', `Bearer ${charlie.jwtToken}`)
      .expect(201);

    const friendship1 = await prismaService.friendship.findFirst({
      where: { requesterId: charlie.userId, addresseeId: dave.userId },
    });
    const friendship2 = await prismaService.friendship.findFirst({
      where: { requesterId: charlie.userId, addresseeId: eve.userId },
    });

    await request(app.getHttpServer())
      .post(`/api/friends/accept/${friendship1?.id}`)
      .set('Authorization', `Bearer ${dave.jwtToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/friends/accept/${friendship2?.id}`)
      .set('Authorization', `Bearer ${eve.jwtToken}`)
      .expect(201);

    // Connect Dave and Eve
    const daveSocket = io(serverUrl, {
      auth: { token: dave.jwtToken },
      transports: ['websocket'],
    });
    const eveSocket = io(serverUrl, {
      auth: { token: eve.jwtToken },
      transports: ['websocket'],
    });

    await Promise.all([
      assertConnected(daveSocket),
      assertConnected(eveSocket),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Charlie should see both online
    const response = await request(app.getHttpServer())
      .get('/api/friends/online')
      .set('Authorization', `Bearer ${charlie.jwtToken}`)
      .expect(200);

    expect(response.body).toHaveLength(2);
    const onlineIds = response.body.map(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
      (item: { friend: { id: string } }) => item.friend.id,
    );
    expect(onlineIds).toContain(dave.userId);
    expect(onlineIds).toContain(eve.userId);

    daveSocket.disconnect();
    eveSocket.disconnect();
  });
});
