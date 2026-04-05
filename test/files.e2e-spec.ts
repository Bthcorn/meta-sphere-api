/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { App } from 'supertest/types';
import { UserRole, RoomType, FileCategory } from '../src/generated/prisma/client';

// Minimal valid PDF content (passes MIME type filter; MinIO stores raw bytes)
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n' +
    '0000000052 00000 n \n0000000101 00000 n \n' +
    'trailer\n<</Size 4/Root 1 0 R>>\nstartxref\n160\n%%EOF\n',
);

describe('FilesController (e2e)', () => {
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
    await prismaService.file.deleteMany({});
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

  describe('POST /files/upload — library upload', () => {
    it('should upload a PDF to a library room and return file metadata', async () => {
      const admin = await registerAndElevateAdmin('files_admin1');
      const user = await registerUser('files_user1');

      // Admin creates a library room
      const roomRes = await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'File Library', type: RoomType.WORKSPACE })
        .expect(201);

      const roomId = roomRes.body.id;

      // User uploads a PDF to the room's library
      const uploadRes = await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'lecture-notes.pdf',
          contentType: 'application/pdf',
        })
        .field('roomId', roomId)
        .field('category', FileCategory.LECTURE_NOTES)
        .field('subject', 'CS3101')
        .field('yearLevel', '2')
        .expect(201);

      expect(uploadRes.body).toHaveProperty('id');
      expect(uploadRes.body.name).toBe('lecture-notes.pdf');
      expect(uploadRes.body.mimeType).toBe('application/pdf');
      expect(uploadRes.body.roomId).toBe(roomId);
      expect(uploadRes.body.category).toBe(FileCategory.LECTURE_NOTES);
      expect(uploadRes.body.subject).toBe('CS3101');
      expect(uploadRes.body.yearLevel).toBe(2);
      expect(uploadRes.body).toHaveProperty('uploadedBy');
      expect(uploadRes.body.uploadedBy.id).toBe(user.userId);
    });

    it('should return 400 when no file is attached', async () => {
      const admin = await registerAndElevateAdmin('files_admin2');
      const user = await registerUser('files_user2');

      const roomRes = await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Empty Upload Room', type: RoomType.WORKSPACE })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${user.token}`)
        .field('roomId', roomRes.body.id)
        .expect(400);
    });

    it('should return 400 when neither roomId nor sessionId is provided', async () => {
      const user = await registerUser('files_user3');

      await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'orphan.pdf',
          contentType: 'application/pdf',
        })
        .expect(400);
    });
  });

  describe('GET /files/room/:roomId — list with filters', () => {
    it('should list files and filter by category', async () => {
      const admin = await registerAndElevateAdmin('files_admin3');
      const user = await registerUser('files_user4');

      const roomRes = await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Filter Room', type: RoomType.WORKSPACE })
        .expect(201);

      const roomId = roomRes.body.id;

      // Upload two files with different categories
      await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'notes.pdf',
          contentType: 'application/pdf',
        })
        .field('roomId', roomId)
        .field('category', FileCategory.LECTURE_NOTES)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'exam.pdf',
          contentType: 'application/pdf',
        })
        .field('roomId', roomId)
        .field('category', FileCategory.PAST_EXAMS)
        .expect(201);

      // List all files in the room
      const allRes = await request(app.getHttpServer())
        .get(`/api/files/room/${roomId}`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(Array.isArray(allRes.body)).toBe(true);
      expect(allRes.body).toHaveLength(2);

      // Filter by category
      const filteredRes = await request(app.getHttpServer())
        .get(`/api/files/room/${roomId}`)
        .query({ category: FileCategory.LECTURE_NOTES })
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(filteredRes.body).toHaveLength(1);
      expect(filteredRes.body[0].category).toBe(FileCategory.LECTURE_NOTES);
      expect(filteredRes.body[0].name).toBe('notes.pdf');
    });

    it('should filter files by subject search', async () => {
      const admin = await registerAndElevateAdmin('files_admin4');
      const user = await registerUser('files_user5');

      const roomRes = await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Search Room', type: RoomType.WORKSPACE })
        .expect(201);

      const roomId = roomRes.body.id;

      await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'algorithms.pdf',
          contentType: 'application/pdf',
        })
        .field('roomId', roomId)
        .field('subject', 'Data Structures and Algorithms')
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'networks.pdf',
          contentType: 'application/pdf',
        })
        .field('roomId', roomId)
        .field('subject', 'Computer Networks')
        .expect(201);

      const searchRes = await request(app.getHttpServer())
        .get(`/api/files/room/${roomId}`)
        .query({ search: 'Algorithms' })
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(searchRes.body).toHaveLength(1);
      expect(searchRes.body[0].name).toBe('algorithms.pdf');
    });
  });

  describe('GET /files/:id/download-url — presigned URL', () => {
    it('should return a presigned MinIO URL for a library file', async () => {
      const admin = await registerAndElevateAdmin('files_admin5');
      const user = await registerUser('files_user6');

      const roomRes = await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Download Room', type: RoomType.WORKSPACE })
        .expect(201);

      const roomId = roomRes.body.id;

      const uploadRes = await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'download-me.pdf',
          contentType: 'application/pdf',
        })
        .field('roomId', roomId)
        .expect(201);

      const fileId = uploadRes.body.id;

      const urlRes = await request(app.getHttpServer())
        .get(`/api/files/${fileId}/download-url`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(urlRes.body).toHaveProperty('url');
      expect(urlRes.body).toHaveProperty('expiresInSeconds', 900);
      expect(typeof urlRes.body.url).toBe('string');
      expect(urlRes.body.url.length).toBeGreaterThan(0);
    });

    it('should return 404 for a non-existent file id', async () => {
      const user = await registerUser('files_user7');

      await request(app.getHttpServer())
        .get('/api/files/00000000-0000-0000-0000-000000000000/download-url')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(404);
    });
  });

  describe('PATCH /files/:id — update metadata', () => {
    it('should allow the uploader to update description, tags, and category', async () => {
      const admin = await registerAndElevateAdmin('files_admin6');
      const user = await registerUser('files_user8');

      const roomRes = await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Patch Room', type: RoomType.WORKSPACE })
        .expect(201);

      const uploadRes = await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'patchable.pdf',
          contentType: 'application/pdf',
        })
        .field('roomId', roomRes.body.id)
        .expect(201);

      const fileId = uploadRes.body.id;

      const patchRes = await request(app.getHttpServer())
        .patch(`/api/files/${fileId}`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          description: 'Updated description',
          category: FileCategory.PAST_EXAMS,
          tags: ['tag1', 'tag2'],
          subject: 'Updated Subject',
          yearLevel: 3,
        })
        .expect(200);

      expect(patchRes.body.description).toBe('Updated description');
      expect(patchRes.body.category).toBe(FileCategory.PAST_EXAMS);
      expect(patchRes.body.tags).toEqual(['tag1', 'tag2']);
      expect(patchRes.body.subject).toBe('Updated Subject');
      expect(patchRes.body.yearLevel).toBe(3);
    });

    it('should return 403 when a non-uploader tries to update', async () => {
      const admin = await registerAndElevateAdmin('files_admin7');
      const uploader = await registerUser('files_user9');
      const other = await registerUser('files_user10');

      const roomRes = await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Forbidden Patch Room', type: RoomType.WORKSPACE })
        .expect(201);

      const uploadRes = await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${uploader.token}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'protected.pdf',
          contentType: 'application/pdf',
        })
        .field('roomId', roomRes.body.id)
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/files/${uploadRes.body.id}`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ description: 'Hijacked' })
        .expect(403);
    });
  });

  describe('DELETE /files/:id — delete file', () => {
    it('should allow the uploader to delete their file', async () => {
      const admin = await registerAndElevateAdmin('files_admin8');
      const user = await registerUser('files_user11');

      const roomRes = await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Delete Room', type: RoomType.WORKSPACE })
        .expect(201);

      const uploadRes = await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'deletable.pdf',
          contentType: 'application/pdf',
        })
        .field('roomId', roomRes.body.id)
        .expect(201);

      const fileId = uploadRes.body.id;

      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/files/${fileId}`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(deleteRes.body.message).toBe('File deleted successfully');

      // File should no longer exist
      await request(app.getHttpServer())
        .get(`/api/files/${fileId}`)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(404);
    });

    it('should return 403 when a non-uploader tries to delete', async () => {
      const admin = await registerAndElevateAdmin('files_admin9');
      const uploader = await registerUser('files_user12');
      const other = await registerUser('files_user13');

      const roomRes = await request(app.getHttpServer())
        .post('/api/admin/rooms')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Protected Delete Room', type: RoomType.WORKSPACE })
        .expect(201);

      const uploadRes = await request(app.getHttpServer())
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${uploader.token}`)
        .attach('file', MINIMAL_PDF, {
          filename: 'locked.pdf',
          contentType: 'application/pdf',
        })
        .field('roomId', roomRes.body.id)
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/files/${uploadRes.body.id}`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(403);
    });
  });
});
