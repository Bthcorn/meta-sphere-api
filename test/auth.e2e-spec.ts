/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { App } from 'supertest/types';

describe('AuthController (e2e)', () => {
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
        transformOptions: {
          enableImplicitConversion: true,
        },
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.setGlobalPrefix('api');

    prismaService = moduleFixture.get<PrismaService>(PrismaService);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // Clean up database after each test
    await prismaService.user.deleteMany({});
  });

  describe('/auth/register (POST)', () => {
    it('should register a new user successfully', async () => {
      const createUserDto = {
        username: 'testuser',
        password: 'password123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
      };

      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(createUserDto)
        .expect(201);

      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user.username).toBe(createUserDto.username);
    });

    it('should register a user with profile picture', async () => {
      const createUserDto = {
        username: 'testuser2',
        password: 'password123',
        email: 'test2@example.com',
        firstName: 'Test',
        lastName: 'User',
        profilePicture: 'https://example.com/profile.jpg',
      };

      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(createUserDto)
        .expect(201);

      expect(response.body).toHaveProperty('access_token');
      expect(response.body.user.username).toBe(createUserDto.username);
    });

    it('should return 409 when username already exists', async () => {
      const createUserDto = {
        username: 'duplicateuser',
        password: 'password123',
        email: 'unique@example.com',
        firstName: 'Test',
        lastName: 'User',
      };

      // First registration should succeed
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(createUserDto)
        .expect(201);

      // Second registration with same username should fail
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          ...createUserDto,
          email: 'different@example.com',
        })
        .expect(409);

      expect(response.body.message).toBe('Username already exists');
    });

    it('should return 400 when required fields are missing', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          // missing password, email, firstName, lastName
        })
        .expect(400);
    });

    it('should return 400 when password is too short', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          password: '12345', // less than 6 characters
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(400);
    });

    it('should return 400 when email is invalid', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          password: 'password123',
          email: '', // empty email
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(400);
    });
  });

  describe('/auth/login (POST)', () => {
    beforeEach(async () => {
      // Register a user first to test login
      await request(app.getHttpServer()).post('/api/auth/register').send({
        username: 'loginuser',
        password: 'password123',
        email: 'login@example.com',
        firstName: 'Login',
        lastName: 'User',
      });
    });

    it('should login successfully with valid credentials', async () => {
      const loginDto = {
        username: 'loginuser',
        password: 'password123',
      };

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(loginDto)
        .expect(200);

      expect(response.body).toHaveProperty('access_token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.username).toBe(loginDto.username);
      expect(response.body.user).toHaveProperty('id');
    });

    it('should return 401 with invalid password', async () => {
      const loginDto = {
        username: 'loginuser',
        password: 'wrongpassword',
      };

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(loginDto)
        .expect(401);

      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should return 401 with non-existent username', async () => {
      const loginDto = {
        username: 'nonexistentuser',
        password: 'password123',
      };

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(loginDto)
        .expect(401);

      expect(response.body.message).toBe('Invalid credentials');
    });

    it('should return 400 when username is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          password: 'password123',
        })
        .expect(400);
    });

    it('should return 400 when password is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          username: 'loginuser',
        })
        .expect(400);
    });

    it('should return 400 when password is too short', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          username: 'loginuser',
          password: '12345', // less than 6 characters
        })
        .expect(400);
    });
  });

  describe('/auth/profile (GET)', () => {
    let accessToken: string;

    beforeEach(async () => {
      // Register a user and get token
      const createUserDto = {
        username: 'profileuser',
        password: 'password123',
        email: 'profile@example.com',
        firstName: 'Profile',
        lastName: 'User',
      };

      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(createUserDto);

      accessToken = response.body.access_token;
    });

    it('should get user profile with valid token', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('userId');
      expect(response.body).toHaveProperty('username');
      expect(response.body.username).toBe('profileuser');
    });

    it('should return 401 without token', async () => {
      await request(app.getHttpServer()).get('/api/auth/profile').expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer invalid_token_here')
        .expect(401);
    });

    it('should return 401 with malformed authorization header', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/profile')
        .set('Authorization', 'InvalidFormat')
        .expect(401);
    });
  });

  describe('/auth/logout (POST)', () => {
    let accessToken: string;

    beforeEach(async () => {
      // Register a user and get token
      const createUserDto = {
        username: 'logoutuser',
        password: 'password123',
        email: 'logout@example.com',
        firstName: 'Logout',
        lastName: 'User',
      };

      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(createUserDto);

      accessToken = response.body.access_token;
    });

    it('should logout successfully with valid token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toBe('Logout successful');
    });

    it('should return 401 without token', async () => {
      await request(app.getHttpServer()).post('/api/auth/logout').expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer invalid_token_here')
        .expect(401);
    });
  });

  describe('Integration tests', () => {
    it('should allow complete user flow: register -> login -> profile -> logout', async () => {
      // 1. Register
      const registerDto = {
        username: 'flowuser',
        password: 'password123',
        email: 'flow@example.com',
        firstName: 'Flow',
        lastName: 'User',
      };

      const registerResponse = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(registerDto)
        .expect(201);

      expect(registerResponse.body).toHaveProperty('access_token');
      const registerToken = registerResponse.body.access_token;

      // 2. Login
      const loginDto = {
        username: 'flowuser',
        password: 'password123',
      };

      const loginResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(loginDto)
        .expect(200);

      expect(loginResponse.body).toHaveProperty('access_token');
      const loginToken = loginResponse.body.access_token;

      // 3. Get Profile with login token
      const profileResponse = await request(app.getHttpServer())
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${loginToken}`)
        .expect(200);

      expect(profileResponse.body.username).toBe('flowuser');

      // 4. Logout
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${loginToken}`)
        .expect(200);

      // 5. Verify we can still access profile with register token
      // (JWT tokens don't truly expire on logout in this implementation)
      await request(app.getHttpServer())
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${registerToken}`)
        .expect(200);
    });

    it('should not allow login after failed registration attempt and then successful registration', async () => {
      // 1. Try to register with invalid data
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: 'failuser',
          password: '123', // too short
          email: 'fail@example.com',
          firstName: 'Fail',
          lastName: 'User',
        })
        .expect(400);

      // 2. Verify login fails (user doesn't exist)
      // Note: Validation error (400) occurs before authentication (401)
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          username: 'failuser',
          password: '123',
        })
        .expect(400);

      // 3. Register successfully
      const registerDto = {
        username: 'failuser',
        password: 'password123',
        email: 'fail@example.com',
        firstName: 'Fail',
        lastName: 'User',
      };

      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(registerDto)
        .expect(201);

      // 4. Now login should work
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          username: 'failuser',
          password: 'password123',
        })
        .expect(200);
    });
  });
});
