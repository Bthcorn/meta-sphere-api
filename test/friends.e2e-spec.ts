/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { App } from 'supertest/types';

interface UserInfo {
  jwtToken: string;
  userId: string;
}

describe('FriendsController (e2e)', () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;

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

    await app.init();
  });

  afterAll(async () => {
    await prismaService.friendship.deleteMany({});
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

    return {
      jwtToken: res.body.access_token,
      userId: res.body.user.id,
    };
  }

  describe('POST /friends/request/:userId — send a friend request', () => {
    it('should send a friend request and return a PENDING friendship', async () => {
      const alice = await registerUser('friends_alice1');
      const bob = await registerUser('friends_bob1');

      const res = await request(app.getHttpServer())
        .post(`/api/friends/request/${bob.userId}`)
        .set('Authorization', `Bearer ${alice.jwtToken}`)
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.status).toBe('PENDING');
      expect(res.body.requesterId).toBe(alice.userId);
      expect(res.body.addresseeId).toBe(bob.userId);
    });

    it('should return 400 when sending a request to yourself', async () => {
      const user = await registerUser('friends_self1');

      await request(app.getHttpServer())
        .post(`/api/friends/request/${user.userId}`)
        .set('Authorization', `Bearer ${user.jwtToken}`)
        .expect(400);
    });

    it('should return 409 when a pending request already exists', async () => {
      const alice = await registerUser('friends_alice2');
      const bob = await registerUser('friends_bob2');

      // First request succeeds
      await request(app.getHttpServer())
        .post(`/api/friends/request/${bob.userId}`)
        .set('Authorization', `Bearer ${alice.jwtToken}`)
        .expect(201);

      // Duplicate request returns 409
      await request(app.getHttpServer())
        .post(`/api/friends/request/${bob.userId}`)
        .set('Authorization', `Bearer ${alice.jwtToken}`)
        .expect(409);
    });
  });

  describe('POST /friends/accept/:requestId — accept a friend request', () => {
    it('should accept a pending request and return an ACCEPTED friendship', async () => {
      const alice = await registerUser('friends_alice3');
      const bob = await registerUser('friends_bob3');

      // Alice sends request
      const sendRes = await request(app.getHttpServer())
        .post(`/api/friends/request/${bob.userId}`)
        .set('Authorization', `Bearer ${alice.jwtToken}`)
        .expect(201);

      const requestId = sendRes.body.id;

      // Bob accepts
      const acceptRes = await request(app.getHttpServer())
        .post(`/api/friends/accept/${requestId}`)
        .set('Authorization', `Bearer ${bob.jwtToken}`)
        .expect(201);

      expect(acceptRes.body.status).toBe('ACCEPTED');
      expect(acceptRes.body.id).toBe(requestId);
    });

    it('should return 403 when non-addressee tries to accept', async () => {
      const alice = await registerUser('friends_alice4');
      const bob = await registerUser('friends_bob4');
      const carol = await registerUser('friends_carol4');

      const sendRes = await request(app.getHttpServer())
        .post(`/api/friends/request/${bob.userId}`)
        .set('Authorization', `Bearer ${alice.jwtToken}`)
        .expect(201);

      const requestId = sendRes.body.id;

      // Carol (neither sender nor addressee) tries to accept
      await request(app.getHttpServer())
        .post(`/api/friends/accept/${requestId}`)
        .set('Authorization', `Bearer ${carol.jwtToken}`)
        .expect(403);
    });

    it('should return 404 for a non-existent request id', async () => {
      const user = await registerUser('friends_user5');

      await request(app.getHttpServer())
        .post('/api/friends/accept/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${user.jwtToken}`)
        .expect(404);
    });
  });

  describe('GET /friends — list accepted friends', () => {
    it('should list accepted friends after accepting a request', async () => {
      const alice = await registerUser('friends_alice5');
      const bob = await registerUser('friends_bob5');

      // Send and accept friend request
      const sendRes = await request(app.getHttpServer())
        .post(`/api/friends/request/${bob.userId}`)
        .set('Authorization', `Bearer ${alice.jwtToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/friends/accept/${sendRes.body.id}`)
        .set('Authorization', `Bearer ${bob.jwtToken}`)
        .expect(201);

      // Alice lists her friends
      const aliceFriendsRes = await request(app.getHttpServer())
        .get('/api/friends')
        .set('Authorization', `Bearer ${alice.jwtToken}`)
        .expect(200);

      expect(Array.isArray(aliceFriendsRes.body)).toBe(true);
      expect(aliceFriendsRes.body).toHaveLength(1);

      const friendship = aliceFriendsRes.body[0];
      expect(friendship).toHaveProperty('friendshipId');
      expect(friendship).toHaveProperty('since');
      expect(friendship.friend.id).toBe(bob.userId);
      expect(friendship.friend).toHaveProperty('username', 'friends_bob5');

      // Friendship is symmetric: Bob also sees Alice
      const bobFriendsRes = await request(app.getHttpServer())
        .get('/api/friends')
        .set('Authorization', `Bearer ${bob.jwtToken}`)
        .expect(200);

      expect(bobFriendsRes.body).toHaveLength(1);
      expect(bobFriendsRes.body[0].friend.id).toBe(alice.userId);
    });

    it('should return an empty list when user has no accepted friends', async () => {
      const user = await registerUser('friends_lonely1');

      const res = await request(app.getHttpServer())
        .get('/api/friends')
        .set('Authorization', `Bearer ${user.jwtToken}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  describe('GET /friends/requests — list pending incoming requests', () => {
    it('should list pending incoming friend requests', async () => {
      const alice = await registerUser('friends_alice6');
      const bob = await registerUser('friends_bob6');

      await request(app.getHttpServer())
        .post(`/api/friends/request/${bob.userId}`)
        .set('Authorization', `Bearer ${alice.jwtToken}`)
        .expect(201);

      // Bob checks incoming requests
      const requestsRes = await request(app.getHttpServer())
        .get('/api/friends/requests')
        .set('Authorization', `Bearer ${bob.jwtToken}`)
        .expect(200);

      expect(Array.isArray(requestsRes.body)).toBe(true);
      expect(requestsRes.body).toHaveLength(1);
      expect(requestsRes.body[0]).toHaveProperty('id');
      expect(requestsRes.body[0].status).toBe('PENDING');
    });
  });

  describe('Integration — full send → accept → list flow', () => {
    it('should complete the full friend request lifecycle', async () => {
      const alice = await registerUser('friends_flow_alice');
      const bob = await registerUser('friends_flow_bob');

      // 1. Alice sends a friend request to Bob
      const sendRes = await request(app.getHttpServer())
        .post(`/api/friends/request/${bob.userId}`)
        .set('Authorization', `Bearer ${alice.jwtToken}`)
        .expect(201);

      expect(sendRes.body.status).toBe('PENDING');
      const requestId = sendRes.body.id;

      // 2. Bob sees the pending request
      const pendingRes = await request(app.getHttpServer())
        .get('/api/friends/requests')
        .set('Authorization', `Bearer ${bob.jwtToken}`)
        .expect(200);

      expect(pendingRes.body.some((r: { id: string }) => r.id === requestId)).toBe(true);

      // 3. Bob accepts
      const acceptRes = await request(app.getHttpServer())
        .post(`/api/friends/accept/${requestId}`)
        .set('Authorization', `Bearer ${bob.jwtToken}`)
        .expect(201);

      expect(acceptRes.body.status).toBe('ACCEPTED');

      // 4. Alice lists friends — Bob appears
      const friendsRes = await request(app.getHttpServer())
        .get('/api/friends')
        .set('Authorization', `Bearer ${alice.jwtToken}`)
        .expect(200);

      expect(friendsRes.body).toHaveLength(1);
      expect(friendsRes.body[0].friend.id).toBe(bob.userId);

      // 5. Pending requests list is now empty for Bob
      const emptyPendingRes = await request(app.getHttpServer())
        .get('/api/friends/requests')
        .set('Authorization', `Bearer ${bob.jwtToken}`)
        .expect(200);

      expect(emptyPendingRes.body).toHaveLength(0);
    });
  });
});
