import { Test, TestingModule } from '@nestjs/testing';
import { SessionFilesGateway } from './session-files.gateway';
import { FilesService } from 'src/files/files.service';
import { MinioService } from 'src/minio/minio.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { WsJwtGuard, WS_USER_KEY } from 'src/realtime/guards/ws-jwt.guard';
import { Socket } from 'socket.io';
import { NotFoundException } from '@nestjs/common';
import { FileCategory } from 'src/generated/prisma/client';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockFileEntity = {
  id: 'file-1',
  name: 'notes.pdf',
  description: null,
  storageKey: 'sessions/session-1/shared/file-1/notes.pdf',
  mimeType: 'application/pdf',
  size: BigInt(1024),
  category: FileCategory.MISC,
  tags: [],
  subject: null,
  yearLevel: null,
  isPublic: true,
  downloadCount: 0,
  roomId: null,
  sessionId: 'session-1',
  uploadedById: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  uploadedBy: {
    id: 'user-1',
    username: 'alice',
    firstName: 'Alice',
    lastName: 'Smith',
  },
};

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockFilesService = {
  getFileById: jest.fn(),
  deleteSessionFiles: jest.fn(),
};

const mockMinioService = {
  removeObject: jest.fn(),
};

const mockPrismaService = {
  sessionParticipant: {
    findFirst: jest.fn(),
  },
  file: {
    delete: jest.fn(),
  },
};

/** Build a minimal Socket stub with an authenticated user. */
function makeClient(userId: string | undefined): Partial<Socket> {
  return {
    data: userId ? { [WS_USER_KEY]: { userId } } : {},
  };
}

/** Build a mock Server stub that records emit calls. */
function makeServer() {
  const emitMock = jest.fn();
  const toMock = jest.fn().mockReturnValue({ emit: emitMock });
  return { to: toMock, emit: emitMock };
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('SessionFilesGateway', () => {
  let gateway: SessionFilesGateway;
  let server: ReturnType<typeof makeServer>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionFilesGateway,
        { provide: FilesService, useValue: mockFilesService },
        { provide: MinioService, useValue: mockMinioService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    })
      .overrideGuard(WsJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();

    gateway = module.get<SessionFilesGateway>(SessionFilesGateway);
    server = makeServer();
    gateway.server = server as unknown as typeof gateway.server;

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  // ── handleFileShare ────────────────────────────────────────────────────────

  describe('handleFileShare', () => {
    it('should broadcast the file to the session room on success', async () => {
      mockFilesService.getFileById.mockResolvedValue(mockFileEntity);

      await gateway.handleFileShare(makeClient('user-1') as Socket, {
        fileId: 'file-1',
        sessionId: 'session-1',
      });

      expect(server.to).toHaveBeenCalledWith('session:session-1');
      expect(server.emit).toHaveBeenCalledWith(
        'session:file_shared',
        mockFileEntity,
      );
    });

    it('should do nothing when no userId is present on the socket', async () => {
      await gateway.handleFileShare(makeClient(undefined) as Socket, {
        fileId: 'file-1',
        sessionId: 'session-1',
      });

      expect(mockFilesService.getFileById).not.toHaveBeenCalled();
      expect(server.to).not.toHaveBeenCalled();
    });

    it('should silently reject when the file is not found', async () => {
      mockFilesService.getFileById.mockRejectedValue(
        new NotFoundException('File not found'),
      );

      await expect(
        gateway.handleFileShare(makeClient('user-1') as Socket, {
          fileId: 'bad-file',
          sessionId: 'session-1',
        }),
      ).resolves.toBeUndefined();

      expect(server.to).not.toHaveBeenCalled();
    });

    it('should silently reject when the file belongs to a different session', async () => {
      mockFilesService.getFileById.mockResolvedValue({
        ...mockFileEntity,
        sessionId: 'other-session',
      });

      await gateway.handleFileShare(makeClient('user-1') as Socket, {
        fileId: 'file-1',
        sessionId: 'session-1',
      });

      expect(server.to).not.toHaveBeenCalled();
    });

    it('should silently reject when the caller is not the file uploader', async () => {
      mockFilesService.getFileById.mockResolvedValue({
        ...mockFileEntity,
        uploadedById: 'other-user',
      });

      await gateway.handleFileShare(makeClient('user-1') as Socket, {
        fileId: 'file-1',
        sessionId: 'session-1',
      });

      expect(server.to).not.toHaveBeenCalled();
    });
  });

  // ── handleFileRemove ───────────────────────────────────────────────────────

  describe('handleFileRemove', () => {
    it('should delete the file and broadcast removal to the session room', async () => {
      mockPrismaService.sessionParticipant.findFirst.mockResolvedValue({
        sessionId: 'session-1',
        userId: 'host-1',
        role: 'HOST',
      });
      mockFilesService.getFileById.mockResolvedValue(mockFileEntity);
      mockPrismaService.file.delete.mockResolvedValue(mockFileEntity);
      mockMinioService.removeObject.mockResolvedValue(undefined);

      await gateway.handleFileRemove(makeClient('host-1') as Socket, {
        fileId: 'file-1',
        sessionId: 'session-1',
      });

      expect(mockPrismaService.file.delete).toHaveBeenCalledWith({
        where: { id: 'file-1' },
      });
      expect(mockMinioService.removeObject).toHaveBeenCalledWith(
        mockFileEntity.storageKey,
      );
      expect(server.to).toHaveBeenCalledWith('session:session-1');
      expect(server.emit).toHaveBeenCalledWith('session:file_removed', {
        fileId: 'file-1',
      });
    });

    it('should do nothing when no userId is present on the socket', async () => {
      await gateway.handleFileRemove(makeClient(undefined) as Socket, {
        fileId: 'file-1',
        sessionId: 'session-1',
      });

      expect(mockPrismaService.sessionParticipant.findFirst).not.toHaveBeenCalled();
      expect(server.to).not.toHaveBeenCalled();
    });

    it('should silently reject when caller is not the session host', async () => {
      mockPrismaService.sessionParticipant.findFirst.mockResolvedValue(null);

      await gateway.handleFileRemove(makeClient('user-1') as Socket, {
        fileId: 'file-1',
        sessionId: 'session-1',
      });

      expect(mockFilesService.getFileById).not.toHaveBeenCalled();
      expect(server.to).not.toHaveBeenCalled();
    });

    it('should silently reject when the file is not found', async () => {
      mockPrismaService.sessionParticipant.findFirst.mockResolvedValue({
        sessionId: 'session-1',
        userId: 'host-1',
        role: 'HOST',
      });
      mockFilesService.getFileById.mockRejectedValue(
        new NotFoundException('File not found'),
      );

      await expect(
        gateway.handleFileRemove(makeClient('host-1') as Socket, {
          fileId: 'bad-file',
          sessionId: 'session-1',
        }),
      ).resolves.toBeUndefined();

      expect(mockPrismaService.file.delete).not.toHaveBeenCalled();
      expect(server.to).not.toHaveBeenCalled();
    });

    it('should silently reject when the file belongs to a different session', async () => {
      mockPrismaService.sessionParticipant.findFirst.mockResolvedValue({
        sessionId: 'session-1',
        userId: 'host-1',
        role: 'HOST',
      });
      mockFilesService.getFileById.mockResolvedValue({
        ...mockFileEntity,
        sessionId: 'other-session',
      });

      await gateway.handleFileRemove(makeClient('host-1') as Socket, {
        fileId: 'file-1',
        sessionId: 'session-1',
      });

      expect(mockPrismaService.file.delete).not.toHaveBeenCalled();
      expect(server.to).not.toHaveBeenCalled();
    });

    it('should still broadcast removal when MinIO deletion fails', async () => {
      mockPrismaService.sessionParticipant.findFirst.mockResolvedValue({
        sessionId: 'session-1',
        userId: 'host-1',
        role: 'HOST',
      });
      mockFilesService.getFileById.mockResolvedValue(mockFileEntity);
      mockPrismaService.file.delete.mockResolvedValue(mockFileEntity);
      mockMinioService.removeObject.mockRejectedValue(new Error('MinIO down'));

      await expect(
        gateway.handleFileRemove(makeClient('host-1') as Socket, {
          fileId: 'file-1',
          sessionId: 'session-1',
        }),
      ).resolves.not.toThrow();

      expect(server.to).toHaveBeenCalledWith('session:session-1');
      expect(server.emit).toHaveBeenCalledWith('session:file_removed', {
        fileId: 'file-1',
      });
    });
  });

  // ── handleSessionEnded ─────────────────────────────────────────────────────

  describe('handleSessionEnded', () => {
    it('should delete all session files and broadcast tray_cleared', async () => {
      mockFilesService.deleteSessionFiles.mockResolvedValue(undefined);

      await gateway.handleSessionEnded({ sessionId: 'session-1' });

      expect(mockFilesService.deleteSessionFiles).toHaveBeenCalledWith(
        'session-1',
      );
      expect(server.to).toHaveBeenCalledWith('session:session-1');
      expect(server.emit).toHaveBeenCalledWith('session:tray_cleared', {
        sessionId: 'session-1',
      });
    });
  });
});
