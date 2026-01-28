import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  ConflictException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User successfully created.' })
  @ApiResponse({ status: 409, description: 'Username already exists.' })
  async create(@Body() createUserDto: CreateUserDto) {
    // Check if username already exists
    const existingUser = await this.usersService.findByUsername({
      username: createUserDto.username,
    });

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    return this.usersService.create(createUserDto);
  }

  @Get(':username')
  @ApiOperation({ summary: 'Get user by username' })
  @ApiResponse({ status: 200, description: 'User found.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async findByUsername(@Param('username') username: string) {
    const user = await this.usersService.findByUsername({
      username: username,
    });

    if (!user) {
      throw new ConflictException('User not found');
    }

    const { password, ...result } = user;
    return result;
  }
}
