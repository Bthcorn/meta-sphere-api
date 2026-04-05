/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { App } from 'supertest/types';

describe('UsersController (e2e)', () => {
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

    prismaService = app.get(PrismaService);

    await app.init();
  });

  afterAll(async () => {
    await prismaService.user.deleteMany({});
    await app.close();
  });

  async function registerUser(
    username: string,
  ): Promise<{ token: string; userId: string }> {
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

    return { token: res.body.access_token, userId: res.body.user.id };
  }

  // ── GET /users/me ───────────────────────────────────────────────────────────

  describe('GET /users/me', () => {
    it('should return the authenticated user profile without password', async () => {
      const { token, userId } = await registerUser('users_me1');

      const res = await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.id).toBe(userId);
      expect(res.body.username).toBe('users_me1');
      expect(res.body.email).toBe('users_me1@example.com');
      expect(res.body).not.toHaveProperty('password');
      expect(res.body).toHaveProperty('firstName', 'Test');
      expect(res.body).toHaveProperty('lastName', 'User');
    });

    it('should return 401 without a token', async () => {
      await request(app.getHttpServer()).get('/api/users/me').expect(401);
    });
  });

  // ── PUT /users/me ───────────────────────────────────────────────────────────

  describe('PUT /users/me', () => {
    it('should update firstName, lastName, and email', async () => {
      const { token } = await registerUser('users_put1');

      const res = await request(app.getHttpServer())
        .put('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstName: 'Updated',
          lastName: 'Name',
          email: 'updated@example.com',
        })
        .expect(200);

      expect(res.body.firstName).toBe('Updated');
      expect(res.body.lastName).toBe('Name');
      expect(res.body.email).toBe('updated@example.com');
      expect(res.body).not.toHaveProperty('password');
    });

    it('should return 400 for an invalid email format', async () => {
      const { token } = await registerUser('users_put2');

      await request(app.getHttpServer())
        .put('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'not-an-email' })
        .expect(400);
    });

    it('should return 401 without a token', async () => {
      await request(app.getHttpServer())
        .put('/api/users/me')
        .send({ firstName: 'Hacker' })
        .expect(401);
    });
  });

  // ── PATCH /users/me/avatar ──────────────────────────────────────────────────

  describe('PATCH /users/me/avatar', () => {
    it('should update the avatar preset', async () => {
      const { token } = await registerUser('users_avatar1');

      const res = await request(app.getHttpServer())
        .patch('/api/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatarPreset: 'avatar_warrior' })
        .expect(200);

      expect(res.body.avatarPreset).toBe('avatar_warrior');
      expect(res.body).not.toHaveProperty('password');
    });

    it('should return 400 when avatarPreset is empty', async () => {
      const { token } = await registerUser('users_avatar2');

      await request(app.getHttpServer())
        .patch('/api/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatarPreset: '' })
        .expect(400);
    });
  });

  // ── PATCH /users/me/status ──────────────────────────────────────────────────

  describe('PATCH /users/me/status', () => {
    it('should update the user status to BUSY', async () => {
      const { token } = await registerUser('users_status1');

      const res = await request(app.getHttpServer())
        .patch('/api/users/me/status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'BUSY' })
        .expect(200);

      expect(res.body.status).toBe('BUSY');
    });

    it('should update the user status to DO_NOT_DISTURB', async () => {
      const { token } = await registerUser('users_status2');

      const res = await request(app.getHttpServer())
        .patch('/api/users/me/status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'DO_NOT_DISTURB' })
        .expect(200);

      expect(res.body.status).toBe('DO_NOT_DISTURB');
    });

    it('should return 400 for an invalid status value', async () => {
      const { token } = await registerUser('users_status3');

      await request(app.getHttpServer())
        .patch('/api/users/me/status')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'INVISIBLE' })
        .expect(400);
    });
  });

  // ── GET /users/:id ──────────────────────────────────────────────────────────

  describe('GET /users/:id', () => {
    it("should return another user's public profile without password", async () => {
      const viewer = await registerUser('users_view1');
      const target = await registerUser('users_target1');

      const res = await request(app.getHttpServer())
        .get(`/api/users/${target.userId}`)
        .set('Authorization', `Bearer ${viewer.token}`)
        .expect(200);

      expect(res.body.id).toBe(target.userId);
      expect(res.body.username).toBe('users_target1');
      expect(res.body).not.toHaveProperty('password');
    });

    it('should return 404 for a non-existent user id', async () => {
      const viewer = await registerUser('users_view2');

      await request(app.getHttpServer())
        .get('/api/users/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${viewer.token}`)
        .expect(404);
    });

    it('should return 401 without a token', async () => {
      const target = await registerUser('users_target2');

      await request(app.getHttpServer())
        .get(`/api/users/${target.userId}`)
        .expect(401);
    });
  });
});
