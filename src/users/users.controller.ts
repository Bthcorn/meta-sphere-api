import {
  Controller,
  Post,
  Body,
  Get,
  Put,
  Patch,
  Param,
  HttpCode,
  HttpStatus,
  ConflictException,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Current user profile returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getCurrentUser(@Request() req) {
    const user = await this.usersService.findById(req.user.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const { password, ...result } = user;
    return result;
  }

  @Put('me')
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile successfully updated.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateCurrentUser(
    @Request() req,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    const user = await this.usersService.updateUser(
      req.user.userId,
      updateUserDto,
    );
    const { password, ...result } = user;
    return result;
  }

  @Patch('me/avatar')
  @ApiOperation({ summary: 'Update current user avatar' })
  @ApiResponse({ status: 200, description: 'Avatar successfully updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateAvatar(@Request() req, @Body() updateAvatarDto: UpdateAvatarDto) {
    const user = await this.usersService.updateAvatar(
      req.user.userId,
      updateAvatarDto.avatarUrl,
    );
    const { password, ...result } = user;
    return result;
  }

  @Patch('me/status')
  @ApiOperation({ summary: 'Update current user status' })
  @ApiResponse({ status: 200, description: 'Status successfully updated.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateStatus(@Request() req, @Body() updateStatusDto: UpdateStatusDto) {
    const user = await this.usersService.updateStatus(
      req.user.userId,
      updateStatusDto.status,
    );
    const { password, ...result } = user;
    return result;
  }

  @Get('online')
  @ApiOperation({ summary: 'Get all online users' })
  @ApiResponse({ status: 200, description: 'List of online users returned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getOnlineUsers() {
    const users = await this.usersService.findOnlineUsers();
    return users.map((user) => {
      const { password, ...result } = user;
      return result;
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiResponse({ status: 200, description: 'User found.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async findById(@Param('id') id: string) {
    const user = await this.usersService.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { password, ...result } = user;
    return result;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User successfully created.' })
  @ApiResponse({ status: 409, description: 'Username already exists.' })
  async create(@Body() createUserDto: CreateUserDto) {
    const existingUser = await this.usersService.findByUsername({
      username: createUserDto.username,
    });

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    return this.usersService.create(createUserDto);
  }
}
