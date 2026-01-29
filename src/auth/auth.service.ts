import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from 'src/users/dto/create-user.dto';
import * as bcrypt from 'bcrypt';
import { User } from 'src/generated/prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(loginDto: LoginDto): Promise<User> {
    const user = await this.usersService.findByUsername({
      username: loginDto.username,
    });
    if (user && (await bcrypt.compare(loginDto.password, user.password))) {
      return user;
    }
    throw new UnauthorizedException('Invalid credentials');
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto);
    const payload: JwtPayload = {
      sub: user.id.toString(),
      username: user.username,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
      },
    };
  }

  async register(createUserDto: CreateUserDto) {
    const existingUser = await this.usersService.findByUsername({
      username: createUserDto.username,
    });

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    const user = await this.usersService.create({
      username: createUserDto.username,
      password: createUserDto.password,
      email: createUserDto.email,
      firstName: createUserDto.firstName,
      lastName: createUserDto.lastName,
      profilePicture: createUserDto.profilePicture,
    });

    const payload: JwtPayload = {
      sub: user.id.toString(),
      username: user.username,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
      },
    };
  }

  async logout() {
    // In a JWT-based system, logout is typically handled client-side
    // by removing the token from storage. This endpoint confirms the logout action.
    // For token blacklisting, you would add the token to a blacklist here.
    return {
      message: 'Logout successful',
    };
  }
}
