import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MinioService } from 'src/minio/minio.service';
import { FileCategory } from 'src/generated/prisma/client';
import { plainToInstance } from 'class-transformer';
import { UploadFileDto } from './dto/upload-file.dto';
import { ListFilesDto } from './dto/list-files.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { FileEntity } from './entities/file.entity';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sanitise a filename to be safe as an object-key path segment. */
function sanitiseFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}

/** Build the MinIO object key based on whether it's a room or user upload. */
function buildStorageKey(
  fileId: string,
  originalName: string,
  roomId?: string,
  userId?: string,
): string {
  const safe = sanitiseFilename(originalName);
  if (roomId) {
    return `rooms/${roomId}/library/${fileId}/${safe}`;
  }
  return `users/${userId}/uploads/${fileId}/${safe}`;
}

const FILE_SELECT = {
  id: true,
  name: true,
  description: true,
  storageKey: true,
  mimeType: true,
  size: true,
  category: true,
  tags: true,
  subject: true,
  yearLevel: true,
  isPublic: true,
  downloadCount: true,
  roomId: true,
  uploadedById: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: {
    select: {
      id: true,
      username: true,
      firstName: true,
      lastName: true,
    },
  },
} as const;

const toEntity = (data: object | object[]) =>
  plainToInstance(FileEntity, data);

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  async upload(
    uploaderId: string,
    file: Express.Multer.File,
    dto: UploadFileDto,
  ) {
    if (!file) throw new BadRequestException('No file provided');

    if (dto.roomId) {
      const room = await this.prisma.room.findUnique({
        where: { id: dto.roomId },
      });
      if (!room || !room.isActive) {
        throw new NotFoundException('Room not found');
      }
    }

    // Reserve a DB row first to get the UUID for the storage key
    const placeholder = await this.prisma.file.create({
      data: {
        name: file.originalname,
        storageKey: '__pending__',
        mimeType: file.mimetype,
        size: file.size,
        uploadedById: uploaderId,
        roomId: dto.roomId ?? null,
        description: dto.description ?? null,
        category: dto.category ?? FileCategory.MISC,
        tags: dto.tags ?? [],
        subject: dto.subject ?? null,
        yearLevel: dto.yearLevel ?? null,
        isPublic: dto.isPublic ?? true,
      },
    });

    const storageKey = buildStorageKey(
      placeholder.id,
      file.originalname,
      dto.roomId,
      uploaderId,
    );

    try {
      await this.minio.putObject(storageKey, file.buffer, file.mimetype);
    } catch (err) {
      // Roll back the DB row if the upload fails
      await this.prisma.file.delete({ where: { id: placeholder.id } });
      throw err;
    }

    const updated = await this.prisma.file.update({
      where: { id: placeholder.id },
      data: { storageKey },
      select: FILE_SELECT,
    });
    return toEntity(updated);
  }

  async listRoomFiles(roomId: string, query: ListFilesDto) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room || !room.isActive) throw new NotFoundException('Room not found');

    const files = await this.prisma.file.findMany({
      where: {
        roomId,
        ...(query.category && { category: query.category }),
        ...(query.tag && { tags: { has: query.tag } }),
        ...(query.subject && {
          subject: { contains: query.subject, mode: 'insensitive' },
        }),
        ...(query.yearLevel !== undefined && { yearLevel: query.yearLevel }),
      },
      select: FILE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return toEntity(files);
  }

  async getDownloadUrl(fileId: string) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found');

    const url = await this.minio.presignedGetObject(file.storageKey);

    // Increment download counter without blocking the response
    void this.prisma.file.update({
      where: { id: fileId },
      data: { downloadCount: { increment: 1 } },
    });

    return { url, expiresInSeconds: 900 };
  }

  async updateMetadata(fileId: string, userId: string, dto: UpdateFileDto) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found');
    if (file.uploadedById !== userId) {
      throw new ForbiddenException('Only the uploader can update this file');
    }

    const updated = await this.prisma.file.update({
      where: { id: fileId },
      data: {
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.subject !== undefined && { subject: dto.subject }),
        ...(dto.yearLevel !== undefined && { yearLevel: dto.yearLevel }),
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
      },
      select: FILE_SELECT,
    });
    return toEntity(updated);
  }

  async deleteFile(fileId: string, userId: string) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('File not found');
    if (file.uploadedById !== userId) {
      throw new ForbiddenException('Only the uploader can delete this file');
    }

    await this.prisma.file.delete({ where: { id: fileId } });

    try {
      await this.minio.removeObject(file.storageKey);
    } catch (err) {
      // DB row is already gone — log but don't surface the MinIO error to the client
      // An orphaned object in MinIO is preferable to a confusing error response
      console.error(`MinIO delete failed for key "${file.storageKey}":`, err);
    }

    return { message: 'File deleted successfully' };
  }
}
