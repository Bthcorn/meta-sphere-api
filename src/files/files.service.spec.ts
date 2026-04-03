import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { FilesService } from './files.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { MinioService } from 'src/minio/minio.service';
import { FileCategory } from 'src/generated/prisma/client';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mockRoom = { id: 'room-1', isActive: true };

const mockFile = {
  id: 'file-1',
  name: 'notes.pdf',
  description: null,
  storageKey: 'rooms/room-1/library/file-1/notes.pdf',
  mimeType: 'application/pdf',
  size: BigInt(1024),
  category: FileCategory.MISC,
  tags: [],
  subject: null,
  yearLevel: null,
  isPublic: true,
  downloadCount: 0,
  roomId: 'room-1',
  sessionId: null,
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

const mockSessionFile = {
  ...mockFile,
  id: 'file-2',
  storageKey: 'sessions/session-1/shared/file-2/notes.pdf',
  roomId: null,
  sessionId: 'session-1',
};

const mockMulterFile: Express.Multer.File = {
  fieldname: 'file',
  originalname: 'notes.pdf',
  encoding: '7bit',
  mimetype: 'application/pdf',
  size: 1024,
  buffer: Buffer.from('pdf-content'),
  destination: '',
  filename: '',
  path: '',
  stream: null as unknown as import('stream').Readable,
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  room: { findUnique: jest.fn() },
  file: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  sessionParticipant: {
    findFirst: jest.fn(),
  },
};

const mockMinio = {
  bucket: 'metasphere-dev',
  putObject: jest.fn(),
  removeObject: jest.fn(),
  presignedGetObject: jest.fn(),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('FilesService', () => {
  let service: FilesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MinioService, useValue: mockMinio },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── upload ────────────────────────────────────────────────────────────────

  describe('upload', () => {
    it('should upload a file to MinIO and return the DB record', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      const placeholder = { ...mockFile, storageKey: '__pending__' };
      mockPrisma.file.create.mockResolvedValue(placeholder);
      mockMinio.putObject.mockResolvedValue(undefined);
      mockPrisma.file.update.mockResolvedValue(mockFile);

      const result = await service.upload('user-1', mockMulterFile, {
        roomId: 'room-1',
      });

      expect(mockPrisma.file.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'notes.pdf',
            mimeType: 'application/pdf',
            uploadedById: 'user-1',
            roomId: 'room-1',
            storageKey: '__pending__',
          }),
        }),
      );
      expect(mockMinio.putObject).toHaveBeenCalledWith(
        expect.stringContaining('library/file-1/'),
        mockMulterFile.buffer,
        'application/pdf',
      );
      expect(mockPrisma.file.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'file-1' },
          data: expect.objectContaining({
            storageKey: expect.stringContaining('library/'),
          }),
        }),
      );
      expect(result.name).toBe('notes.pdf');
    });

    it('should build a library key when roomId is provided', async () => {
      const userFile = {
        ...mockFile,
        roomId: 'room-1',
        sessionId: null,
        storageKey: 'rooms/room-1/library/file-1/notes.pdf',
      };
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.file.create.mockResolvedValue({
        ...userFile,
        storageKey: '__pending__',
      });
      mockMinio.putObject.mockResolvedValue(undefined);
      mockPrisma.file.update.mockResolvedValue(userFile);

      await service.upload('user-1', mockMulterFile, { roomId: 'room-1' });

      expect(mockPrisma.room.findUnique).toHaveBeenCalledWith({
        where: { id: 'room-1' },
      });
      const { data } = mockPrisma.file.update.mock.calls[0][0] as {
        data: { storageKey: string };
      };
      expect(data.storageKey).toContain('rooms/room-1/library/');
    });

    it('should build a sessions key when sessionId is provided', async () => {
      mockPrisma.sessionParticipant.findFirst.mockResolvedValue({
        sessionId: 'session-1',
        userId: 'user-1',
      });
      mockPrisma.file.create.mockResolvedValue({
        ...mockSessionFile,
        storageKey: '__pending__',
      });
      mockMinio.putObject.mockResolvedValue(undefined);
      mockPrisma.file.update.mockResolvedValue(mockSessionFile);

      await service.upload('user-1', mockMulterFile, {
        sessionId: 'session-1',
      });

      const { data } = mockPrisma.file.update.mock.calls[0][0] as {
        data: { storageKey: string };
      };
      expect(data.storageKey).toContain('sessions/session-1/shared/');
      expect(mockPrisma.room.findUnique).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when caller is not an active session participant', async () => {
      mockPrisma.sessionParticipant.findFirst.mockResolvedValue(null);

      await expect(
        service.upload('user-1', mockMulterFile, { sessionId: 'session-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should rollback the DB record when MinIO upload fails', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.file.create.mockResolvedValue({
        ...mockFile,
        storageKey: '__pending__',
      });
      mockMinio.putObject.mockRejectedValue(new Error('MinIO unavailable'));
      mockPrisma.file.delete.mockResolvedValue(mockFile);

      await expect(
        service.upload('user-1', mockMulterFile, { roomId: 'room-1' }),
      ).rejects.toThrow('MinIO unavailable');

      expect(mockPrisma.file.delete).toHaveBeenCalledWith({
        where: { id: 'file-1' },
      });
    });

    it('should throw BadRequestException when no file is provided', async () => {
      await expect(
        service.upload('user-1', null as unknown as Express.Multer.File, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for an unsupported MIME type', async () => {
      const imageFile: Express.Multer.File = {
        ...mockMulterFile,
        mimetype: 'image/png',
        originalname: 'photo.png',
      };

      await expect(
        service.upload('user-1', imageFile, { roomId: 'room-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when neither roomId nor sessionId is provided', async () => {
      await expect(
        service.upload('user-1', mockMulterFile, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when both roomId and sessionId are provided', async () => {
      await expect(
        service.upload('user-1', mockMulterFile, {
          roomId: 'room-1',
          sessionId: 'session-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when room does not exist', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(null);

      await expect(
        service.upload('user-1', mockMulterFile, { roomId: 'bad-room' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when room is inactive', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({
        ...mockRoom,
        isActive: false,
      });

      await expect(
        service.upload('user-1', mockMulterFile, { roomId: 'room-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should apply default category MISC when not provided', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.file.create.mockResolvedValue({
        ...mockFile,
        storageKey: '__pending__',
      });
      mockMinio.putObject.mockResolvedValue(undefined);
      mockPrisma.file.update.mockResolvedValue(mockFile);

      await service.upload('user-1', mockMulterFile, { roomId: 'room-1' });

      const { data } = mockPrisma.file.create.mock.calls[0][0] as {
        data: { category: FileCategory };
      };
      expect(data.category).toBe(FileCategory.MISC);
    });
  });

  // ── getFileById ───────────────────────────────────────────────────────────

  describe('getFileById', () => {
    it('should return the file entity when found', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(mockFile);

      const result = await service.getFileById('file-1');

      expect(mockPrisma.file.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'file-1' } }),
      );
      expect(result.id).toBe('file-1');
    });

    it('should throw NotFoundException when file does not exist', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(null);

      await expect(service.getFileById('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── listRoomFiles ─────────────────────────────────────────────────────────

  describe('listRoomFiles', () => {
    it('should return files for a valid active room', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.file.findMany.mockResolvedValue([mockFile]);

      const result = await service.listRoomFiles('room-1', {});

      expect(mockPrisma.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ roomId: 'room-1' }),
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should filter by category', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.file.findMany.mockResolvedValue([]);

      await service.listRoomFiles('room-1', {
        category: FileCategory.PAST_EXAMS,
      });

      const [call] = mockPrisma.file.findMany.mock.calls as [
        { where: { category?: FileCategory } },
      ][];
      expect(call[0].where.category).toBe(FileCategory.PAST_EXAMS);
    });

    it('should filter by tag using array contains', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.file.findMany.mockResolvedValue([]);

      await service.listRoomFiles('room-1', { tag: 'algorithms' });

      const [call] = mockPrisma.file.findMany.mock.calls as [
        { where: { tags?: object } },
      ][];
      expect(call[0].where.tags).toEqual({ has: 'algorithms' });
    });

    it('should filter by subject with case-insensitive match', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.file.findMany.mockResolvedValue([]);

      await service.listRoomFiles('room-1', { subject: 'data structures' });

      const [call] = mockPrisma.file.findMany.mock.calls as [
        { where: { subject?: object } },
      ][];
      expect(call[0].where.subject).toEqual({
        contains: 'data structures',
        mode: 'insensitive',
      });
    });

    it('should filter by yearLevel', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.file.findMany.mockResolvedValue([]);

      await service.listRoomFiles('room-1', { yearLevel: 2 });

      const [call] = mockPrisma.file.findMany.mock.calls as [
        { where: { yearLevel?: number } },
      ][];
      expect(call[0].where.yearLevel).toBe(2);
    });

    it('should apply full-text search across name, subject, and description', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(mockRoom);
      mockPrisma.file.findMany.mockResolvedValue([]);

      await service.listRoomFiles('room-1', { search: 'algebra' });

      const [call] = mockPrisma.file.findMany.mock.calls as [
        { where: { OR?: object[] } },
      ][];
      expect(call[0].where.OR).toEqual(
        expect.arrayContaining([
          { name: { contains: 'algebra', mode: 'insensitive' } },
          { subject: { contains: 'algebra', mode: 'insensitive' } },
          { description: { contains: 'algebra', mode: 'insensitive' } },
        ]),
      );
    });

    it('should throw NotFoundException when room does not exist', async () => {
      mockPrisma.room.findUnique.mockResolvedValue(null);

      await expect(service.listRoomFiles('bad-room', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when room is inactive', async () => {
      mockPrisma.room.findUnique.mockResolvedValue({
        ...mockRoom,
        isActive: false,
      });

      await expect(service.listRoomFiles('room-1', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── listSessionFiles ──────────────────────────────────────────────────────

  describe('listSessionFiles', () => {
    it('should return session files for a participant', async () => {
      mockPrisma.sessionParticipant.findFirst.mockResolvedValue({
        sessionId: 'session-1',
        userId: 'user-1',
      });
      mockPrisma.file.findMany.mockResolvedValue([mockSessionFile]);

      const result = await service.listSessionFiles('session-1', 'user-1');

      expect(mockPrisma.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sessionId: 'session-1' }),
          orderBy: { createdAt: 'asc' },
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('should filter session files by name search', async () => {
      mockPrisma.sessionParticipant.findFirst.mockResolvedValue({
        sessionId: 'session-1',
        userId: 'user-1',
      });
      mockPrisma.file.findMany.mockResolvedValue([]);

      await service.listSessionFiles('session-1', 'user-1', {
        search: 'notes',
      });

      const [call] = mockPrisma.file.findMany.mock.calls as [
        { where: { name?: object } },
      ][];
      expect(call[0].where.name).toEqual({
        contains: 'notes',
        mode: 'insensitive',
      });
    });

    it('should throw ForbiddenException when caller is not a session participant', async () => {
      mockPrisma.sessionParticipant.findFirst.mockResolvedValue(null);

      await expect(
        service.listSessionFiles('session-1', 'user-outsider'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── getDownloadUrl ────────────────────────────────────────────────────────

  describe('getDownloadUrl', () => {
    it('should return a presigned URL and increment the download counter', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(mockFile);
      mockMinio.presignedGetObject.mockResolvedValue(
        'https://minio/presigned-url',
      );
      mockPrisma.file.update.mockResolvedValue({
        ...mockFile,
        downloadCount: 1,
      });

      const result = await service.getDownloadUrl('file-1');

      expect(mockMinio.presignedGetObject).toHaveBeenCalledWith(
        mockFile.storageKey,
      );
      expect(result).toEqual({
        url: 'https://minio/presigned-url',
        expiresInSeconds: 900,
      });
    });

    it('should throw NotFoundException when file does not exist', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(null);

      await expect(service.getDownloadUrl('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── updateMetadata ────────────────────────────────────────────────────────

  describe('updateMetadata', () => {
    it('should update file metadata as the uploader', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(mockFile);
      mockPrisma.file.update.mockResolvedValue({
        ...mockFile,
        description: 'Updated notes',
        tags: ['exam', 'algorithms'],
        subject: 'CS101',
        yearLevel: 2,
      });

      const result = await service.updateMetadata('file-1', 'user-1', {
        description: 'Updated notes',
        tags: ['exam', 'algorithms'],
        subject: 'CS101',
        yearLevel: 2,
      });

      expect(mockPrisma.file.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'file-1' },
          data: expect.objectContaining({
            description: 'Updated notes',
            tags: ['exam', 'algorithms'],
            subject: 'CS101',
            yearLevel: 2,
          }),
        }),
      );
      expect(result.tags).toEqual(['exam', 'algorithms']);
    });

    it('should only update fields present in dto (partial update)', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(mockFile);
      mockPrisma.file.update.mockResolvedValue({
        ...mockFile,
        subject: 'Math',
      });

      await service.updateMetadata('file-1', 'user-1', { subject: 'Math' });

      const { data } = mockPrisma.file.update.mock.calls[0][0] as {
        data: object;
      };
      expect(data).toEqual({ subject: 'Math' });
    });

    it('should throw ForbiddenException when caller is not the uploader', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(mockFile);

      await expect(
        service.updateMetadata('file-1', 'user-other', { description: 'Hack' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when file does not exist', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(null);

      await expect(
        service.updateMetadata('bad-id', 'user-1', { description: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── deleteFile ────────────────────────────────────────────────────────────

  describe('deleteFile', () => {
    it('should delete the DB record and remove the object from MinIO', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(mockFile);
      mockPrisma.file.delete.mockResolvedValue(mockFile);
      mockMinio.removeObject.mockResolvedValue(undefined);

      const result = await service.deleteFile('file-1', 'user-1');

      expect(mockPrisma.file.delete).toHaveBeenCalledWith({
        where: { id: 'file-1' },
      });
      expect(mockMinio.removeObject).toHaveBeenCalledWith(mockFile.storageKey);
      expect(result.message).toBe('File deleted successfully');
    });

    it('should still return success when MinIO removal fails (DB row already deleted)', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(mockFile);
      mockPrisma.file.delete.mockResolvedValue(mockFile);
      mockMinio.removeObject.mockRejectedValue(new Error('MinIO down'));
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const result = await service.deleteFile('file-1', 'user-1');

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(mockFile.storageKey),
        expect.any(Error),
      );
      expect(result.message).toBe('File deleted successfully');
      errorSpy.mockRestore();
    });

    it('should throw ForbiddenException when caller is not the uploader', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(mockFile);

      await expect(service.deleteFile('file-1', 'user-other')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException when file does not exist', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(null);

      await expect(service.deleteFile('bad-id', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── deleteSessionFiles ────────────────────────────────────────────────────

  describe('deleteSessionFiles', () => {
    it('should remove all session files from MinIO and delete DB rows', async () => {
      mockPrisma.file.findMany.mockResolvedValue([
        { id: 'file-2', storageKey: 'sessions/session-1/shared/file-2/notes.pdf' },
        { id: 'file-3', storageKey: 'sessions/session-1/shared/file-3/slides.pdf' },
      ]);
      mockMinio.removeObject.mockResolvedValue(undefined);
      mockPrisma.file.deleteMany.mockResolvedValue({ count: 2 });

      await service.deleteSessionFiles('session-1');

      expect(mockMinio.removeObject).toHaveBeenCalledTimes(2);
      expect(mockPrisma.file.deleteMany).toHaveBeenCalledWith({
        where: { sessionId: 'session-1' },
      });
    });

    it('should continue deleting remaining files when a MinIO removal fails', async () => {
      mockPrisma.file.findMany.mockResolvedValue([
        { id: 'file-2', storageKey: 'sessions/session-1/shared/file-2/notes.pdf' },
        { id: 'file-3', storageKey: 'sessions/session-1/shared/file-3/slides.pdf' },
      ]);
      mockMinio.removeObject
        .mockRejectedValueOnce(new Error('MinIO error'))
        .mockResolvedValueOnce(undefined);
      mockPrisma.file.deleteMany.mockResolvedValue({ count: 2 });

      await expect(
        service.deleteSessionFiles('session-1'),
      ).resolves.not.toThrow();

      expect(mockMinio.removeObject).toHaveBeenCalledTimes(2);
      expect(mockPrisma.file.deleteMany).toHaveBeenCalled();
    });

    it('should handle sessions with no files gracefully', async () => {
      mockPrisma.file.findMany.mockResolvedValue([]);
      mockPrisma.file.deleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deleteSessionFiles('empty-session'),
      ).resolves.not.toThrow();

      expect(mockMinio.removeObject).not.toHaveBeenCalled();
    });
  });
});
