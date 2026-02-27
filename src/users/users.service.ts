import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, User, UserStatus } from 'src/generated/prisma/client';
import * as bcrypt from 'bcrypt';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        ...createUserDto,
        password: await bcrypt.hash(createUserDto.password, 10),
      },
    });
  }

  async findByUsername(
    where: Prisma.UserWhereUniqueInput,
  ): Promise<User | null> {
    return this.prisma.user.findUnique({ where });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async updateUser(userId: string, dto: UpdateUserDto): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { ...dto, lastActive: new Date() },
    });
  }

  async updateAvatar(userId: string, avatarPreset: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarPreset, lastActive: new Date() },
    });
  }

  async updateStatus(userId: string, status: UserStatus): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { status, lastActive: new Date() },
    });
  }

  async findOnlineUsers(): Promise<User[]> {
    return this.prisma.user.findMany({
      where: {
        status: {
          notIn: [UserStatus.AWAY, UserStatus.DO_NOT_DISTURB],
        },
      },
      orderBy: { lastActive: 'desc' },
    });
  }
}
