import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserStatus } from 'src/generated/prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';

const mockUser = {
  id: 'user-uuid-1',
  email: 'alice@example.com',
  username: 'alice',
  password: '$2b$10$hashedpassword',
  firstName: 'Alice',
  lastName: 'Smith',
  profilePicture: null,
  avatarPreset: 'avatar1',
  status: UserStatus.AVAILABLE,
  lastActive: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should hash the password and create a user', async () => {
      mockPrisma.user.create.mockResolvedValue(mockUser);

      const result = await service.create({
        email: 'alice@example.com',
        username: 'alice',
        password: 'plaintext',
        firstName: 'Alice',
        lastName: 'Smith',
      });

      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
      const { data } = mockPrisma.user.create.mock.calls[0][0] as {
        data: { password: string };
      };
      expect(data.password).not.toBe('plaintext');
      expect(data.password).toMatch(/^\$2b\$/);
      expect(result).toEqual(mockUser);
    });
  });

  // ── findByUsername ───────────────────────────────────────────────────────

  describe('findByUsername', () => {
    it('should return a user when found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findByUsername({ username: 'alice' });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: 'alice' },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findByUsername({ username: 'nobody' });

      expect(result).toBeNull();
    });
  });

  // ── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('should return a user by id', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findById('user-uuid-1');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null when id does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ── updateUser ───────────────────────────────────────────────────────────

  describe('updateUser', () => {
    it('should update allowed profile fields and bump lastActive', async () => {
      const dto: UpdateUserDto = { firstName: 'Alicia', lastName: 'Jones' };
      const updated = { ...mockUser, ...dto };
      mockPrisma.user.update.mockResolvedValue(updated);

      const result = await service.updateUser('user-uuid-1', dto);

      const { data } = mockPrisma.user.update.mock.calls[0][0] as {
        data: { firstName: string; lastActive: Date };
      };
      expect(data.firstName).toBe('Alicia');
      expect(data.lastActive).toBeInstanceOf(Date);
      expect(result).toEqual(updated);
    });
  });

  // ── updateAvatar ─────────────────────────────────────────────────────────

  describe('updateAvatar', () => {
    it('should update avatarPreset', async () => {
      const updated = { ...mockUser, avatarPreset: 'avatar5' };
      mockPrisma.user.update.mockResolvedValue(updated);

      const result = await service.updateAvatar('user-uuid-1', 'avatar5');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { avatarPreset: 'avatar5', lastActive: expect.any(Date) },
      });
      expect(result.avatarPreset).toBe('avatar5');
    });
  });

  // ── updateStatus ─────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('should update status and bump lastActive', async () => {
      const updated = { ...mockUser, status: UserStatus.BUSY };
      mockPrisma.user.update.mockResolvedValue(updated);

      const result = await service.updateStatus('user-uuid-1', UserStatus.BUSY);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: { status: UserStatus.BUSY, lastActive: expect.any(Date) },
      });
      expect(result.status).toBe(UserStatus.BUSY);
    });
  });

  // ── findOnlineUsers ───────────────────────────────────────────────────────

  describe('findOnlineUsers', () => {
    it('should return users excluding AWAY and DO_NOT_DISTURB', async () => {
      mockPrisma.user.findMany.mockResolvedValue([mockUser]);

      const result = await service.findOnlineUsers();

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          status: {
            notIn: [UserStatus.AWAY, UserStatus.DO_NOT_DISTURB],
          },
        },
        orderBy: { lastActive: 'desc' },
      });
      expect(result).toHaveLength(1);
    });

    it('should return an empty array when no online users', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.findOnlineUsers();

      expect(result).toEqual([]);
    });
  });
});
