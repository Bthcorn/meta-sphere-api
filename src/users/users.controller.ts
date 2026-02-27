import {
  Controller,
  Get,
  Put,
  Patch,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorator/current-user.decorator';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get own profile' })
  @ApiResponse({ status: 200, description: 'Current user profile returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getMe(@CurrentUser() user: JwtUser) {
    const found = await this.usersService.findById(user.userId);
    if (!found) throw new NotFoundException('User not found');
    const { password: _, ...result } = found;
    return result;
  }

  @Put('me')
  @ApiOperation({ summary: 'Update profile (name, email, etc.)' })
  @ApiResponse({ status: 200, description: 'Profile successfully updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateMe(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateUserDto,
  ) {
    const updated = await this.usersService.updateUser(user.userId, dto);
    const { password: _, ...result } = updated;
    return result;
  }

  @Patch('me/avatar')
  @ApiOperation({ summary: 'Change avatar preset' })
  @ApiResponse({ status: 200, description: 'Avatar preset updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateAvatar(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateAvatarDto,
  ) {
    const updated = await this.usersService.updateAvatar(
      user.userId,
      dto.avatarPreset,
    );
    const { password: _, ...result } = updated;
    return result;
  }

  @Patch('me/status')
  @ApiOperation({ summary: 'Set status (AVAILABLE, BUSY, AWAY, DO_NOT_DISTURB, FOCUS)' })
  @ApiResponse({ status: 200, description: 'Status updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateStatus(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateStatusDto,
  ) {
    const updated = await this.usersService.updateStatus(user.userId, dto.status);
    const { password: _, ...result } = updated;
    return result;
  }

  @Get('online')
  @ApiOperation({ summary: 'List currently online users' })
  @ApiResponse({ status: 200, description: 'Online users returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getOnlineUsers() {
    const users = await this.usersService.findOnlineUsers();
    return users.map(({ password: _, ...u }) => u);
  }

  @Get(':id')
  @ApiOperation({ summary: "View another user's public profile" })
  @ApiResponse({ status: 200, description: 'User found.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async findById(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('User not found');
    const { password: _, ...result } = user;
    return result;
  }
}
