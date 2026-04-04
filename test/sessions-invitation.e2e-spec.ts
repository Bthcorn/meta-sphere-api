import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RoomsService } from '../src/rooms/rooms.service';
import { App } from 'supertest/types';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { DefaultEventsMap } from 'socket.io';
import { RoomType, SessionType } from '../src/generated/prisma/client';

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

function assertOnEvent<T>(
  client: Socket<DefaultEventsMap, DefaultEventsMap>,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off(event, onEvent);
      client.off('connect_error', onError);
      reject(new Error(`Timeout waiting for event "${event}"`));
    }, timeoutMs);

    const onEvent = (data: T) => {
      clearTimeout(timeout);
      client.off('connect_error', onError);
      resolve(data);
    };
    const onError = (err: Error) => {
      clearTimeout(timeout);
      client.off(event, onEvent);
      reject(err);
    };

    client.once(event, onEvent);
    client.once('connect_error', onError);
  });
}

describe('Session Invitations (e2e)', () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;
  let serverUrl: string;
  let roomsService: RoomsService;

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
    roomsService = app.get(RoomsService);
  });

  afterAll(async () => {
    await prismaService.$disconnect();
    await app.close();
  });

  it('should send real-time invitation to online friends when creating session', async () => {
    const host = await registerUser(app, 'host_invite');
    const friend1 = await registerUser(app, 'friend1_invite');
    const friend2 = await registerUser(app, 'friend2_invite');

    // Make friends
    await request(app.getHttpServer())
      .post(`/api/friends/request/${friend1.userId}`)
      .set('Authorization', `Bearer ${host.jwtToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/friends/request/${friend2.userId}`)
      .set('Authorization', `Bearer ${host.jwtToken}`)
      .expect(201);

    const friendship1 = await prismaService.friendship.findFirst({
      where: { requesterId: host.userId, addresseeId: friend1.userId },
    });
    const friendship2 = await prismaService.friendship.findFirst({
      where: { requesterId: host.userId, addresseeId: friend2.userId },
    });

    await request(app.getHttpServer())
      .post(`/api/friends/accept/${friendship1?.id}`)
      .set('Authorization', `Bearer ${friend1.jwtToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/friends/accept/${friendship2?.id}`)
      .set('Authorization', `Bearer ${friend2.jwtToken}`)
      .expect(201);

    // Connect friends via WebSocket
    const friend1Socket = io(serverUrl, {
      auth: { token: friend1.jwtToken },
      transports: ['websocket'],
    });
    const friend2Socket = io(serverUrl, {
      auth: { token: friend2.jwtToken },
      transports: ['websocket'],
    });

    await Promise.all([
      assertConnected(friend1Socket),
      assertConnected(friend2Socket),
    ]);

    // Wait for presence to register
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create a room
    const room = await roomsService.create(host.userId, {
      name: 'Invitation Test Room',
      type: RoomType.WORKSPACE,
      description: 'Testing invitations',
    });

    const roomId = room.id;

    // Set up listeners for session_invitation event
    const friend1InvitePromise = assertOnEvent<{
      sessionId: string;
      roomId: string;
      hostId: string;
      sessionTitle: string;
      sessionType: string;
    }>(friend1Socket, 'session_invitation');

    const friend2InvitePromise = assertOnEvent<{
      sessionId: string;
      roomId: string;
      hostId: string;
      sessionTitle: string;
      sessionType: string;
    }>(friend2Socket, 'session_invitation');

    // Create session with invited friends
    const sessionResponse = await request(app.getHttpServer())
      .post('/api/sessions')
      .set('Authorization', `Bearer ${host.jwtToken}`)
      .send({
        roomId,
        title: 'Study Session with Friends',
        type: SessionType.STUDY,
        invitedFriendsIds: [friend1.userId, friend2.userId],
      })
      .expect(201);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const sessionId: string = sessionResponse.body.id;

    // Both friends should receive the invitation
    const [friend1Invite, friend2Invite] = await Promise.all([
      friend1InvitePromise,
      friend2InvitePromise,
    ]);

    expect(friend1Invite).toMatchObject({
      sessionId,
      roomId,
      hostId: host.userId,
      sessionTitle: 'Study Session with Friends',
      sessionType: SessionType.STUDY,
    });

    expect(friend2Invite).toMatchObject({
      sessionId,
      roomId,
      hostId: host.userId,
      sessionTitle: 'Study Session with Friends',
      sessionType: SessionType.STUDY,
    });

    friend1Socket.disconnect();
    friend2Socket.disconnect();
  });

  it('should not send invitation to offline friends', async () => {
    const host2 = await registerUser(app, 'host2_invite');
    const onlineFriend = await registerUser(app, 'online_friend_invite');
    const offlineFriend = await registerUser(app, 'offline_friend_invite');

    // Make friends
    await request(app.getHttpServer())
      .post(`/api/friends/request/${onlineFriend.userId}`)
      .set('Authorization', `Bearer ${host2.jwtToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/friends/request/${offlineFriend.userId}`)
      .set('Authorization', `Bearer ${host2.jwtToken}`)
      .expect(201);

    const friendship1 = await prismaService.friendship.findFirst({
      where: { requesterId: host2.userId, addresseeId: onlineFriend.userId },
    });
    const friendship2 = await prismaService.friendship.findFirst({
      where: { requesterId: host2.userId, addresseeId: offlineFriend.userId },
    });

    await request(app.getHttpServer())
      .post(`/api/friends/accept/${friendship1?.id}`)
      .set('Authorization', `Bearer ${onlineFriend.jwtToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/friends/accept/${friendship2?.id}`)
      .set('Authorization', `Bearer ${offlineFriend.jwtToken}`)
      .expect(201);

    // Only connect online friend
    const onlineFriendSocket = io(serverUrl, {
      auth: { token: onlineFriend.jwtToken },
      transports: ['websocket'],
    });

    await assertConnected(onlineFriendSocket);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create room
    const room = await roomsService.create(host2.userId, {
      name: 'Offline Test Room',
      type: RoomType.WORKSPACE,
    });

    const roomId = room.id;

    // Set up listener
    const onlineInvitePromise = assertOnEvent<{
      sessionId: string;
    }>(onlineFriendSocket, 'session_invitation');

    // Create session inviting both
    await request(app.getHttpServer())
      .post('/api/sessions')
      .set('Authorization', `Bearer ${host2.jwtToken}`)
      .send({
        roomId,
        title: 'Mixed Presence Session',
        type: SessionType.STUDY,
        invitedFriendsIds: [onlineFriend.userId, offlineFriend.userId],
      })
      .expect(201);

    // Only online friend should receive invitation
    const onlineInvite = await onlineInvitePromise;
    expect(onlineInvite).toBeDefined();
    expect(onlineInvite.sessionId).toBeDefined();

    onlineFriendSocket.disconnect();
  });

  it('should handle session creation without invited friends', async () => {
    const soloHost = await registerUser(app, 'solo_host');

    const room = await roomsService.create(soloHost.userId, {
      name: 'Solo Room',
      type: RoomType.WORKSPACE,
    });

    const roomId = room.id;

    // Create session without inviting anyone
    const sessionResponse = await request(app.getHttpServer())
      .post('/api/sessions')
      .set('Authorization', `Bearer ${soloHost.jwtToken}`)
      .send({
        roomId,
        title: 'Solo Session',
        type: SessionType.STUDY,
      })
      .expect(201);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(sessionResponse.body.id).toBeDefined();
  });
});
