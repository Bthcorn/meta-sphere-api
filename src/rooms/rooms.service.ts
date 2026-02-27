import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { AccessType, Room } from 'src/generated/prisma/client';
import { CreateRoomDto } from './dto/create-room.dto';

type RoomWithOccupancy = Omit<Room, 'password'> & { occupancy: number };
type SafeUser = { id: string; username: string; firstName: string; lastName: string; profilePicture: string | null; avatarPreset: string; status: string };

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────────

  private stripPassword<T extends { password?: string | null }>(
    room: T,
  ): Omit<T, 'password'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...safe } = room;
    return safe;
  }

  private async withOccupancy(room: Room): Promise<RoomWithOccupancy> {
    const occupancy = await this.redis.roomOccupancy(room.id);
    return { ...this.stripPassword(room), occupancy };
  }

  private async getActiveRoom(id: string): Promise<Room> {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room || !room.isActive) throw new NotFoundException('Room not found');
    return room;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async create(userId: string, dto: CreateRoomDto): Promise<RoomWithOccupancy> {
    const hashedPassword =
      dto.accessType === AccessType.PRIVATE && dto.password
        ? await bcrypt.hash(dto.password, 10)
        : null;

    const room = await this.prisma.room.create({
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        accessType: dto.accessType ?? AccessType.PUBLIC,
        capacity: dto.capacity ?? 30,
        password: hashedPassword,
        thumbnail: dto.thumbnail,
        createdById: userId,
      },
    });

    return this.withOccupancy(room);
  }

  async findAllActive(): Promise<RoomWithOccupancy[]> {
    const rooms = await this.prisma.room.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(rooms.map((r) => this.withOccupancy(r)));
  }

  async findById(id: string): Promise<RoomWithOccupancy> {
    const room = await this.getActiveRoom(id);
    return this.withOccupancy(room);
  }

  async joinRoom(
    roomId: string,
    userId: string,
    password?: string,
  ): Promise<{ message: string }> {
    const room = await this.getActiveRoom(roomId);

    if (room.accessType === AccessType.PRIVATE) {
      if (!password) {
        throw new BadRequestException('This room requires a password');
      }
      if (!room.password || !(await bcrypt.compare(password, room.password))) {
        throw new ForbiddenException('Incorrect room password');
      }
    }

    const occupancy = await this.redis.roomOccupancy(roomId);
    const alreadyIn = await this.redis.roomHasUser(roomId, userId);

    if (!alreadyIn && occupancy >= room.capacity) {
      throw new ConflictException('Room is at full capacity');
    }

    await this.redis.roomAdd(roomId, userId);
    return { message: 'Joined room successfully' };
  }

  async leaveRoom(
    roomId: string,
    userId: string,
  ): Promise<{ message: string }> {
    await this.getActiveRoom(roomId);
    await this.redis.roomRemove(roomId, userId);
    return { message: 'Left room successfully' };
  }

  async getUsersInRoom(roomId: string): Promise<SafeUser[]> {
    await this.getActiveRoom(roomId);

    const userIds = await this.redis.roomUserIds(roomId);
    if (userIds.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        profilePicture: true,
        avatarPreset: true,
        status: true,
      },
    });

    return users;
  }
}
