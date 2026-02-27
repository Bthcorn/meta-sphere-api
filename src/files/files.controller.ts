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
import { UpdateFileDto } from './dto/update-file.dto';
import { CurrentUser } from 'src/auth/decorator/current-user.decorator';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';
import { FileCategory } from 'src/generated/prisma/client';

const MAX_FILE_SIZE = parseInt(
  process.env.MAX_FILE_SIZE_BYTES ?? '10485760',
  10,
);

@ApiTags('files')
@ApiBearerAuth('JWT-auth')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (!file.originalname) {
          return cb(new BadRequestException('File must have a name'), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'File upload with optional metadata',
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        roomId: { type: 'string', format: 'uuid' },
        description: { type: 'string' },
        category: { type: 'string', enum: Object.values(FileCategory) },
        tags: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        yearLevel: { type: 'integer', minimum: 1, maximum: 4 },
        isPublic: { type: 'boolean' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a file to MinIO and create a DB record' })
  @ApiResponse({ status: 201, description: 'File uploaded.' })
  @ApiResponse({ status: 400, description: 'No file or invalid payload.' })
  upload(
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
  ) {
    return this.filesService.upload(user.userId, file, dto);
  }

  @Get('room/:roomId')
  @ApiOperation({ summary: 'List files in a room (filterable)' })
  @ApiResponse({ status: 200, description: 'Files returned.' })
  @ApiResponse({ status: 404, description: 'Room not found.' })
  listRoomFiles(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: ListFilesDto,
  ) {
    return this.filesService.listRoomFiles(roomId, query);
  }

  @Get(':id/download-url')
  @ApiOperation({ summary: 'Generate a presigned MinIO URL (15 min expiry)' })
  @ApiResponse({ status: 200, description: 'Presigned URL returned.' })
  @ApiResponse({ status: 404, description: 'File not found.' })
  getDownloadUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.filesService.getDownloadUrl(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update file metadata' })
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

  @Delete(':id')
  @ApiOperation({ summary: 'Delete file from DB and MinIO' })
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
