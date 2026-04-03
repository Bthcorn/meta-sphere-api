import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MinioService } from 'src/minio/minio.service';
import { FileCategory, ParticipantStatus } from 'src/generated/prisma/client';
import { plainToInstance } from 'class-transformer';
import { UploadFileDto } from './dto/upload-file.dto';
import { ListFilesDto } from './dto/list-files.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { FileEntity } from './entities/file.entity';
import { ListSessionFilesDto } from './dto/list-session-files.dto';
import { ALLOWED_MIME_TYPES } from './constants/files';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sanitise a filename to be safe as an object-key path segment. */
function sanitiseFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
}

/**
 * Build the MinIO object key.
 *
 * Bucket structure (one bucket per environment):
 *   library/{fileId}/{originalFilename}                 ← Library room files
 *   sessions/{sessionId}/shared/{fileId}/{filename}     ← Session tray files
 *   users/{userId}/uploads/{fileId}/{filename}          ← Personal / avatar uploads
 */
function buildStorageKey(
  fileId: string,
  originalName: string,
  context: { roomId?: string; sessionId?: string; userId?: string },
): string {
  const safe = sanitiseFilename(originalName);
  if (context.sessionId) {
    return `sessions/${context.sessionId}/shared/${fileId}/${safe}`;
  }
  if (context.roomId) {
    return `rooms/${context.roomId}/library/${fileId}/${safe}`;
  }
  return `users/${context.userId}/uploads/${fileId}/${safe}`;
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
  sessionId: true,
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

const toEntity = (data: object | object[]) => plainToInstance(FileEntity, data);

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  // ── upload ──────────────────────────────────────────────────────────────────

  async upload(
    uploaderId: string,
    file: Express.Multer.File,
    dto: UploadFileDto,
  ) {
    if (!file) throw new BadRequestException('No file provided');

    // MIME type guard (second defence — controller fileFilter is the first)
    if (
      !ALLOWED_MIME_TYPES.includes(
        file.mimetype as (typeof ALLOWED_MIME_TYPES)[number],
      )
    ) {
      throw new BadRequestException('Only PDF and DOCX files are allowed');
    }

    // Must provide exactly one context
    if (!dto.roomId && !dto.sessionId) {
      throw new BadRequestException(
        'Provide either roomId (library) or sessionId (session tray)',
      );
    }
    if (dto.roomId && dto.sessionId) {
      throw new BadRequestException(
        'Provide only one of roomId or sessionId, not both',
      );
    }

    // ── Library upload: validate room exists ──
    if (dto.roomId) {
      const room = await this.prisma.room.findUnique({
        where: { id: dto.roomId },
      });
      if (!room || !room.isActive)
        throw new NotFoundException('Room not found');
    }

    // ── Session tray upload: validate caller is an active participant ──
    if (dto.sessionId) {
      const participant = await this.prisma.sessionParticipant.findFirst({
        where: {
          sessionId: dto.sessionId,
          userId: uploaderId,
          status: ParticipantStatus.ACTIVE,
          session: { status: 'ACTIVE' },
        },
      });
      if (!participant) {
        throw new ForbiddenException(
          'You must be an active participant of this session to share files',
        );
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
        sessionId: dto.sessionId ?? null,
        description: dto.description ?? null,
        category: dto.category ?? FileCategory.MISC,
        tags: dto.tags ?? [],
        subject: dto.subject ?? null,
        yearLevel: dto.yearLevel ?? null,
        isPublic: dto.isPublic ?? true,
      },
    });

    const storageKey = buildStorageKey(placeholder.id, file.originalname, {
      sessionId: dto.sessionId,
      roomId: dto.roomId,
      userId: uploaderId,
    });

    try {
      await this.minio.putObject(storageKey, file.buffer, file.mimetype);
    } catch (err) {
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

  // ── getFileById ─────────────────────────────────────────────────────────────
  async getFileById(fileId: string) {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      select: FILE_SELECT,
    });
    if (!file) throw new NotFoundException('File not found');
    return toEntity(file);
  }

  async listRoomFiles(roomId: string, query: ListFilesDto) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room || !room.isActive) throw new NotFoundException('Room not found');

    const sortField = query.sortBy ?? 'createdAt';
    const sortDir = query.sortOrder ?? 'desc';

    const files = await this.prisma.file.findMany({
      where: {
        roomId,
        ...(query.category && { category: query.category }),
        ...(query.tag && { tags: { has: query.tag } }),
        ...(query.subject && {
          subject: { contains: query.subject, mode: 'insensitive' },
        }),
        ...(query.yearLevel !== undefined && { yearLevel: query.yearLevel }),
        ...(query.search && {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { subject: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
      },
      select: FILE_SELECT,
      orderBy: { [sortField]: sortDir },
    });

    return toEntity(files);
  }

  // ── listSessionFiles ────────────────────────────────────────────────────────

  async listSessionFiles(
    sessionId: string,
    callerId: string,
    query: ListSessionFilesDto = {},
  ) {
    // Verify caller is or was a participant (any status — they might have left
    // but still need to see what was shared during the session)
    const participant = await this.prisma.sessionParticipant.findFirst({
      where: { sessionId, userId: callerId },
    });
    if (!participant) {
      throw new ForbiddenException(
        'You must be a session participant to view session files',
      );
    }

    const files = await this.prisma.file.findMany({
      where: {
        sessionId,
        ...(query.search && {
          name: { contains: query.search, mode: 'insensitive' },
        }),
      },
      select: FILE_SELECT,
      orderBy: { createdAt: 'asc' }, // chronological for tray
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

  // ── deleteSessionFiles ──────────────────────────────────────────────────────
  // Called by session.ended EventEmitter listener in SessionFilesGateway.
  // Deletes all files from MinIO that were shared in the session.
  // DB rows are removed via Cascade from the Session FK.
  async deleteSessionFiles(sessionId: string): Promise<void> {
    const files = await this.prisma.file.findMany({
      where: { sessionId },
      select: { id: true, storageKey: true },
    });

    for (const file of files) {
      try {
        await this.minio.removeObject(file.storageKey);
      } catch {
        // Non-fatal — continue cleaning up the rest
      }
    }

    // DB rows cascade-delete when the session is deleted.
    // If session is only ended (not deleted), delete file rows explicitly:
    await this.prisma.file.deleteMany({ where: { sessionId } });
  }
}
