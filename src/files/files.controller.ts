import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { FilesService } from './files.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { ListFilesDto } from './dto/list-files.dto';
import { ListSessionFilesDto } from './dto/list-session-files.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { CurrentUser } from 'src/auth/decorator/current-user.decorator';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';
import { FileCategory } from 'src/generated/prisma/client';
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE } from './constants/files';

@ApiTags('files')
@ApiBearerAuth('JWT-auth')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  // ── POST /files/upload ──────────────────────────────────────────────────────

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          return cb(
            new BadRequestException('Only PDF and DOCX files are allowed'),
            false,
          );
        }
        if (!file.originalname) {
          return cb(new BadRequestException('File must have a name'), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description:
      'File upload with optional metadata. Provide either roomId (library) or sessionId (session tray), not both.',
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        roomId: {
          type: 'string',
          format: 'uuid',
          description: 'Library room ID',
        },
        sessionId: {
          type: 'string',
          format: 'uuid',
          description: 'Session ID for tray upload',
        },
        description: { type: 'string' },
        category: { type: 'string', enum: Object.values(FileCategory) },
        tags: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        yearLevel: { type: 'integer', minimum: 1, maximum: 4 },
        isPublic: { type: 'boolean' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a PDF or DOCX file (max 15 MB) to library or session tray',
  })
  @ApiResponse({ status: 201, description: 'File uploaded.' })
  @ApiResponse({
    status: 400,
    description: 'Invalid file type, size, or missing context.',
  })
  @ApiResponse({ status: 403, description: 'Not a session participant.' })
  upload(
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
  ) {
    return this.filesService.upload(user.userId, file, dto);
  }

  // ── GET /files/room/:roomId ─────────────────────────────────────────────────
  // NOTE: Specific param routes (/room/, /session/) must come BEFORE the
  // generic /:id route to avoid NestJS matching them as a file UUID.

  @Get('room/:roomId')
  @ApiOperation({
    summary: 'List library files in a room (filterable, sortable)',
  })
  @ApiResponse({ status: 200, description: 'Files returned.' })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  listRoomFiles(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: ListFilesDto,
  ) {
    return this.filesService.listRoomFiles(roomId, query);
  }

  // ── GET /files/session/:sessionId ───────────────────────────────────────────

  @Get('session/:sessionId')
  @ApiOperation({
    summary: 'List files shared in a session tray (participants only)',
  })
  @ApiResponse({ status: 200, description: 'Files returned.' })
  @ApiResponse({ status: 403, description: 'Not a session participant.' })
  listSessionFiles(
    @CurrentUser() user: JwtUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query() query: ListSessionFilesDto,
  ) {
    return this.filesService.listSessionFiles(sessionId, user.userId, query);
  }

  // ── GET /files/:id ──────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single file by ID (metadata only, no bytes)',
  })
  @ApiResponse({ status: 200, description: 'File metadata returned.' })
  @ApiResponse({ status: 404, description: 'File not found.' })
  getFile(@Param('id', ParseUUIDPipe) id: string) {
    return this.filesService.getFileById(id);
  }

  // ── GET /files/:id/download-url ─────────────────────────────────────────────

  @Get(':id/download-url')
  @ApiOperation({ summary: 'Generate a presigned MinIO URL (15 min expiry)' })
  @ApiResponse({ status: 200, description: 'Presigned URL returned.' })
  @ApiResponse({ status: 404, description: 'File not found.' })
  getDownloadUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.filesService.getDownloadUrl(id);
  }

  // ── PATCH /files/:id ────────────────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({ summary: 'Update file metadata (uploader only)' })
  @ApiResponse({ status: 200, description: 'Metadata updated.' })
  @ApiResponse({ status: 403, description: 'Not the uploader.' })
  @ApiResponse({ status: 404, description: 'File not found.' })
  updateMetadata(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFileDto,
  ) {
    return this.filesService.updateMetadata(id, user.userId, dto);
  }

  // ── DELETE /files/:id ───────────────────────────────────────────────────────

  @Delete(':id')
  @ApiOperation({ summary: 'Delete file from DB and MinIO (uploader only)' })
  @ApiResponse({ status: 200, description: 'File deleted.' })
  @ApiResponse({ status: 403, description: 'Not the uploader.' })
  @ApiResponse({ status: 404, description: 'File not found.' })
  deleteFile(
    @CurrentUser() user: JwtUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.filesService.deleteFile(id, user.userId);
  }
}
