import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { Room } from 'livekit-client';

// Node shims are required for livekit-client to run in a headless environment
import wrtc from '@roamhq/wrtc';
import ws from 'ws';
global.WebSocket = ws as any;
global.RTCPeerConnection = wrtc.RTCPeerConnection;
global.RTCIceCandidate = wrtc.RTCIceCandidate;
global.RTCSessionDescription = wrtc.RTCSessionDescription;
global.RTCRtpTransceiver = wrtc.RTCRtpTransceiver;
global.RTCRtpSender = wrtc.RTCRtpSender;
global.RTCRtpReceiver = wrtc.RTCRtpReceiver;
global.navigator = { userAgent: 'node' } as any;

describe('Sessions Voice Chat (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    prisma = app.get(PrismaService);
    await app.init();
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  afterEach(async () => {
    await prisma.sessionParticipant.deleteMany();
    await prisma.session.deleteMany();
    await prisma.room.deleteMany();
    await prisma.user.deleteMany();
  });

  const registerUser = async (username: string, isAdmin = false) => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `${username}@example.com`,
        username,
        password: 'Password123!',
        firstName: 'Test',
        lastName: 'User',
      });

    if (res.status !== 201) {
      console.error('Failed to register:', res.body);
      throw new Error(`Failed to register: ${res.status}`);
    }

    if (isAdmin) {
      // Force admin role directly in DB since registration probably defaults to USER
      const user = await prisma.user.findUnique({ where: { username } });
      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: 'ADMIN' },
        });
      }

      // We may need to re-login to get the admin token
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          username,
          password: 'Password123!',
        });
      return loginRes.body;
    }

    return res.body;
  };

  it('should generate a voice token and allow connecting to LiveKit for active session', async () => {
    // 1. Setup user & room
    const hostAuth = await registerUser('hostuser', true);
    const roomRes = await request(app.getHttpServer())
      .post('/api/admin/rooms')
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .send({
        name: 'VoiceRoom',
        description: 'Test voice chat',
        type: 'WORKSPACE',
      });

    if (roomRes.status !== 201)
      throw new Error('Failed to create room: ' + JSON.stringify(roomRes.body));
    const roomId = roomRes.body.id;

    // 2. Schedule Session
    const sessRes = await request(app.getHttpServer())
      .post('/api/sessions')
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .send({
        roomId,
        title: 'Voice Session',
        type: 'MEETING',
        scheduledStartTime: new Date(Date.now() + 10000).toISOString(),
      });

    if (sessRes.status !== 201)
      throw new Error(
        'Failed to create session: ' + JSON.stringify(sessRes.body),
      );
    const sessionId = sessRes.body.id;

    // 3. Start Session (Moves to ACTIVE)
    await request(app.getHttpServer())
      .post(`/api/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .expect(200);

    // 4. Request Voice Token
    const tokenRes = await request(app.getHttpServer())
      .post(`/api/sessions/${sessionId}/voice-token`)
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .expect(200);

    const token = tokenRes.body.token as string;
    const livekitUrl = tokenRes.body.url as string;
    expect(token).toBeDefined();
    expect(livekitUrl).toBeDefined();

    // 5. Verify token against ephemeral LiveKit server
    const wsUrl = livekitUrl.replace('http:', 'ws:').replace('https:', 'wss:');
    const room = new Room();

    try {
      await room.connect(wsUrl, token);
      expect(room.state).toBe('connected');
    } finally {
      await room.disconnect();
    }
  }, 20000);

  const decodeJwtPayload = (token: string): Record<string, unknown> => {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  };

  it('should include screen share sources in voice token for MEETING session', async () => {
    const hostAuth = await registerUser('screenshare-host', true);

    const roomRes = await request(app.getHttpServer())
      .post('/api/admin/rooms')
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .send({ name: 'ScreenShareRoom', type: 'WORKSPACE' });
    expect(roomRes.status).toBe(201);

    const sessRes = await request(app.getHttpServer())
      .post('/api/sessions')
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .send({
        roomId: roomRes.body.id,
        title: 'Screen Share Meeting',
        type: 'MEETING',
        scheduledStartTime: new Date(Date.now() + 5000).toISOString(),
      });
    expect(sessRes.status).toBe(201);
    const sessionId = sessRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .expect(200);

    const tokenRes = await request(app.getHttpServer())
      .post(`/api/sessions/${sessionId}/voice-token`)
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .expect(200);

    const payload = decodeJwtPayload(tokenRes.body.token);
    const sources: string[] = (payload?.video as any)?.canPublishSources ?? [];

    expect(sources).toContain('screen_share');
    expect(sources).toContain('screen_share_audio');
    expect(sources).toContain('microphone');
  }, 20000);

  it('should NOT include screen share sources for STUDY type session', async () => {
    const hostAuth = await registerUser('study-host', true);

    const roomRes = await request(app.getHttpServer())
      .post('/api/admin/rooms')
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .send({ name: 'StudyRoom', type: 'WORKSPACE' });
    expect(roomRes.status).toBe(201);

    const sessRes = await request(app.getHttpServer())
      .post('/api/sessions')
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .send({
        roomId: roomRes.body.id,
        title: 'Study Session',
        type: 'STUDY',
        scheduledStartTime: new Date(Date.now() + 5000).toISOString(),
      });
    expect(sessRes.status).toBe(201);
    const sessionId = sessRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .expect(200);

    const tokenRes = await request(app.getHttpServer())
      .post(`/api/sessions/${sessionId}/voice-token`)
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .expect(200);

    const payload = decodeJwtPayload(tokenRes.body.token);
    const sources: string[] = (payload?.video as any)?.canPublishSources ?? [];

    expect(sources).not.toContain('screen_share');
    expect(sources).not.toContain('screen_share_audio');
    expect(sources).toContain('microphone');
  }, 20000);

  it('should deny voice token for users not in the session', async () => {
    const hostAuth = await registerUser('hostuser2', true);
    const bystanderAuth = await registerUser('bystander');

    const roomRes = await request(app.getHttpServer())
      .post('/api/admin/rooms')
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .send({ name: 'PrivateRoom', type: 'WORKSPACE' });

    if (roomRes.status !== 201)
      throw new Error(
        'Failed to create private room: ' + JSON.stringify(roomRes.body),
      );

    const sessRes = await request(app.getHttpServer())
      .post('/api/sessions')
      .set('Authorization', `Bearer ${hostAuth.access_token}`)
      .send({
        roomId: roomRes.body.id,
        title: 'Private Session',
        type: 'MEETING',
        scheduledStartTime: new Date(Date.now() + 10000).toISOString(),
      });

    if (sessRes.status !== 201)
      throw new Error(
        'Failed to create private session: ' + JSON.stringify(sessRes.body),
      );
    const sessionId = sessRes.body.id;
    await request(app.getHttpServer())
      .post(`/api/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${hostAuth.access_token}`);

    // Bystander attempts to get token
    await request(app.getHttpServer())
      .post(`/api/sessions/${sessionId}/voice-token`)
      .set('Authorization', `Bearer ${bystanderAuth.access_token}`)
      .expect(403);
  });
});
