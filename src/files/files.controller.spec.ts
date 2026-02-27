import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileCategory, UserRole } from 'src/generated/prisma/client';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const uploaderUser: JwtUser = { userId: 'user-1', username: 'alice', role: UserRole.USER };
const otherUser: JwtUser = { userId: 'user-2', username: 'bob', role: UserRole.USER };

const mockFileRecord = {
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

// ── Mock service ──────────────────────────────────────────────────────────────

const mockFilesService = {
  upload: jest.fn(),
  listRoomFiles: jest.fn(),
  getDownloadUrl: jest.fn(),
  updateMetadata: jest.fn(),
  deleteFile: jest.fn(),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('FilesController', () => {
  let controller: FilesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [{ provide: FilesService, useValue: mockFilesService }],
    }).compile();

    controller = module.get<FilesController>(FilesController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ── POST /files/upload ────────────────────────────────────────────────────

  describe('upload', () => {
    it('should call service with userId, file and dto', async () => {
      mockFilesService.upload.mockResolvedValue(mockFileRecord);

      const result = await controller.upload(
        uploaderUser,
        mockMulterFile,
        { roomId: 'room-1' },
      );

      expect(mockFilesService.upload).toHaveBeenCalledWith(
        'user-1',
        mockMulterFile,
        { roomId: 'room-1' },
      );
      expect(result.name).toBe('notes.pdf');
    });

    it('should propagate BadRequestException when no file is sent', async () => {
      mockFilesService.upload.mockRejectedValue(new BadRequestException());

      await expect(
        controller.upload(uploaderUser, null as unknown as Express.Multer.File, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate NotFoundException when room not found', async () => {
      mockFilesService.upload.mockRejectedValue(new NotFoundException());

      await expect(
        controller.upload(uploaderUser, mockMulterFile, { roomId: 'bad-room' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should upload without a roomId', async () => {
      const noRoomFile = { ...mockFileRecord, roomId: null };
      mockFilesService.upload.mockResolvedValue(noRoomFile);

      const result = await controller.upload(uploaderUser, mockMulterFile, {});

      expect(mockFilesService.upload).toHaveBeenCalledWith('user-1', mockMulterFile, {});
      expect(result.roomId).toBeNull();
    });
  });

  // ── GET /files/room/:roomId ───────────────────────────────────────────────

  describe('listRoomFiles', () => {
    it('should return files for a room', async () => {
      mockFilesService.listRoomFiles.mockResolvedValue([mockFileRecord]);

      const result = await controller.listRoomFiles('room-1', {});

      expect(mockFilesService.listRoomFiles).toHaveBeenCalledWith('room-1', {});
      expect(result).toHaveLength(1);
    });

    it('should forward all filters to the service', async () => {
      mockFilesService.listRoomFiles.mockResolvedValue([]);

      await controller.listRoomFiles('room-1', {
        category: FileCategory.PAST_EXAMS,
        tag: 'algorithms',
        subject: 'CS101',
        yearLevel: 2,
      });

      expect(mockFilesService.listRoomFiles).toHaveBeenCalledWith('room-1', {
        category: FileCategory.PAST_EXAMS,
        tag: 'algorithms',
        subject: 'CS101',
        yearLevel: 2,
      });
    });

    it('should propagate NotFoundException when room not found', async () => {
      mockFilesService.listRoomFiles.mockRejectedValue(new NotFoundException());

      await expect(controller.listRoomFiles('bad-room', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── GET /files/:id/download-url ───────────────────────────────────────────

  describe('getDownloadUrl', () => {
    it('should return a presigned URL with expiry', async () => {
      const urlResponse = {
        url: 'https://minio/presigned',
        expiresInSeconds: 900,
      };
      mockFilesService.getDownloadUrl.mockResolvedValue(urlResponse);

      const result = await controller.getDownloadUrl('file-1');

      expect(mockFilesService.getDownloadUrl).toHaveBeenCalledWith('file-1');
      expect(result.url).toBe('https://minio/presigned');
      expect(result.expiresInSeconds).toBe(900);
    });

    it('should propagate NotFoundException when file not found', async () => {
      mockFilesService.getDownloadUrl.mockRejectedValue(new NotFoundException());

      await expect(controller.getDownloadUrl('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── PATCH /files/:id ──────────────────────────────────────────────────────

  describe('updateMetadata', () => {
    it('should call service with id, userId and dto', async () => {
      const updated = {
        ...mockFileRecord,
        description: 'Lecture slides',
        tags: ['cs', 'oop'],
      };
      mockFilesService.updateMetadata.mockResolvedValue(updated);

      const result = await controller.updateMetadata(uploaderUser, 'file-1', {
        description: 'Lecture slides',
        tags: ['cs', 'oop'],
      });

      expect(mockFilesService.updateMetadata).toHaveBeenCalledWith(
        'file-1',
        'user-1',
        { description: 'Lecture slides', tags: ['cs', 'oop'] },
      );
      expect(result.tags).toEqual(['cs', 'oop']);
    });

    it('should propagate ForbiddenException when caller is not the uploader', async () => {
      mockFilesService.updateMetadata.mockRejectedValue(
        new ForbiddenException(),
      );

      await expect(
        controller.updateMetadata(otherUser, 'file-1', { subject: 'Hack' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should propagate NotFoundException when file not found', async () => {
      mockFilesService.updateMetadata.mockRejectedValue(new NotFoundException());

      await expect(
        controller.updateMetadata(uploaderUser, 'bad-id', { subject: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── DELETE /files/:id ─────────────────────────────────────────────────────

  describe('deleteFile', () => {
    it('should call service with id and userId and return success message', async () => {
      mockFilesService.deleteFile.mockResolvedValue({
        message: 'File deleted successfully',
      });

      const result = await controller.deleteFile(uploaderUser, 'file-1');

      expect(mockFilesService.deleteFile).toHaveBeenCalledWith(
        'file-1',
        'user-1',
      );
      expect(result.message).toBe('File deleted successfully');
    });

    it('should propagate ForbiddenException when caller is not the uploader', async () => {
      mockFilesService.deleteFile.mockRejectedValue(new ForbiddenException());

      await expect(
        controller.deleteFile(otherUser, 'file-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should propagate NotFoundException when file not found', async () => {
      mockFilesService.deleteFile.mockRejectedValue(new NotFoundException());

      await expect(
        controller.deleteFile(uploaderUser, 'bad-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
