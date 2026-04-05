/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { App } from 'supertest/types';
import { UserRole, RoomType } from '../src/generated/prisma/client';

describe('RoomsController (e2e)', () => {
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
    await prismaService.room.deleteMany({});
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

    return {
      token: res.body.access_token,
      userId: res.body.user.id,
    };
  }

  async function registerAndElevateAdmin(
    username: string,
  ): Promise<{ token: string; userId: string }> {
    const { userId } = await registerUser(username);

    await prismaService.user.update({
      where: { id: userId },
      data: { role: UserRole.ADMIN },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'password123' })
      .expect(200);

    return { token: loginRes.body.access_token, userId };
  }

  describe('POST /admin/rooms', () => {
    it('should allow an admin to create a room', async () => {
      const admin = await registerAndElevateAdmin('rooms_admin1');

      const res = await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Study Hall', type: RoomType.WORKSPACE })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Study Hall');
      expect(res.body.type).toBe(RoomType.WORKSPACE);
      expect(res.body).not.toHaveProperty('password');
      expect(res.body).toHaveProperty('occupancy', 0);
    });

    it('should return 403 when a non-admin attempts to create a room', async () => {
      const user = await registerUser('rooms_regular1');

      await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ name: 'Forbidden Room', type: RoomType.WORKSPACE })
        .expect(403);
    });

    it('should return 401 without a token', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .send({ name: 'No Auth Room', type: RoomType.WORKSPACE })
        .expect(401);
    });
  });

  describe('GET /rooms', () => {
    it('should list active rooms and include one just created by admin', async () => {
      const admin = await registerAndElevateAdmin('rooms_admin2');
      const user = await registerUser('rooms_user2');

      const createRes = await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Visible Room', type: RoomType.FOCUS })
        .expect(201);

      const roomId = createRes.body.id;

      const listRes = await request(app.getHttpServer())
        .get('/api/rooms')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(Array.isArray(listRes.body)).toBe(true);

      const found = listRes.body.find((r: { id: string }) => r.id === roomId);
      expect(found).toBeDefined();
      expect(found).toHaveProperty('occupancy');
      expect(found).not.toHaveProperty('password');
    });
  });

  describe('GET /rooms/:id', () => {
    it('should return a specific room by id with occupancy', async () => {
      const admin = await registerAndElevateAdmin('rooms_admin3');
      const user = await registerUser('rooms_user3');

      const createRes = await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Single Room', type: RoomType.MEETING })
        .expect(201);

      const roomId = createRes.body.id;

      const getRes = await request(app.getHttpServer())
        .get(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(getRes.body.id).toBe(roomId);
      expect(getRes.body.name).toBe('Single Room');
      expect(getRes.body.type).toBe(RoomType.MEETING);
      expect(getRes.body).toHaveProperty('occupancy', 0);
      expect(getRes.body).not.toHaveProperty('password');
    });

    it('should return 404 for a non-existent room id', async () => {
      const user = await registerUser('rooms_user4');

      await request(app.getHttpServer())
        .get('/api/rooms/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(404);
    });
  });
});
