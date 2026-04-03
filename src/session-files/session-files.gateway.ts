import { UseGuards } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard, WS_USER_KEY } from '../realtime/guards/ws-jwt.guard';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionFileShareDto } from './dto/session-file-share.dto';
import { SessionFileRemoveDto } from './dto/session-file-remove.dto';
import { ParticipantRole } from 'src/generated/prisma/client';
import { MinioService } from 'src/minio/minio.service';

@UseGuards(WsJwtGuard)
@WebSocketGateway({ cors: { origin: '*' } })
export class SessionFilesGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly filesService: FilesService,
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  /**
   * session:file_share
   *
   * Emitted by the uploader's client immediately after a successful REST upload.
   * The gateway validates that the file belongs to the claimed session and was
   * uploaded by the calling user, then broadcasts the full FileEntity to all
   * sockets in the session room so their trays update in real time.
   *
   * Client payload:  { fileId: string, sessionId: string }
   * Broadcast event: session:file_shared  → FileEntity
   */
  @SubscribeMessage('session:file_share')
  async handleFileShare(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SessionFileShareDto,
  ): Promise<void> {
    const userId = client.data[WS_USER_KEY]?.userId as string | undefined;
    if (!userId) return;

    // Fetch the file and verify ownership and context
    let file;
    try {
      file = await this.filesService.getFileById(dto.fileId);
    } catch {
      return; // File not found — silent reject
    }

    if (file.sessionId !== dto.sessionId || file.uploadedById !== userId) {
      return; // Mismatched ownership — silent reject
    }

    this.server
      .to(`session:${dto.sessionId}`)
      .emit('session:file_shared', file);
  }

  /**
   * session:file_remove
   *
   * Host-only. Deletes the file from DB and MinIO, then broadcasts removal
   * so all clients clear it from their trays.
   *
   * Client payload:  { fileId: string, sessionId: string }
   * Broadcast event: session:file_removed  → { fileId: string }
   */
  @SubscribeMessage('session:file_remove')
  async handleFileRemove(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SessionFileRemoveDto,
  ): Promise<void> {
    const userId = client.data[WS_USER_KEY]?.userId as string | undefined;
    if (!userId) return;

    // Verify caller is the session host
    const participant = await this.prisma.sessionParticipant.findFirst({
      where: {
        sessionId: dto.sessionId,
        userId,
        role: ParticipantRole.HOST,
      },
    });
    if (!participant) return; // Not the host — silent reject

    // Verify file belongs to this session
    let file;
    try {
      file = await this.filesService.getFileById(dto.fileId);
    } catch {
      return;
    }
    if (file.sessionId !== dto.sessionId) return;

    // Delete the file — use the uploader ID stored in the file record
    // because the host may not be the original uploader
    await this.prisma.file.delete({ where: { id: dto.fileId } });
    try {
      await this.minio.removeObject(file.storageKey);
    } catch {
      // Non-fatal — continue cleaning up the rest
    }

    // Then broadcast:
    this.server
      .to(`session:${dto.sessionId}`)
      .emit('session:file_removed', { fileId: dto.fileId });
  }

  /**
   * session.ended EventEmitter listener
   *
   * When a session ends, delete all files shared in that session's tray
   * from both MinIO and the DB. Then broadcast session:tray_cleared so
   * clients know to empty their tray stores.
   *
   * This handler fires from SessionsService.end() via EventEmitter.
   */
  @OnEvent('session.ended')
  async handleSessionEnded(payload: { sessionId: string }): Promise<void> {
    const { sessionId } = payload;

    await this.filesService.deleteSessionFiles(sessionId);

    this.server
      .to(`session:${sessionId}`)
      .emit('session:tray_cleared', { sessionId });
  }
}
