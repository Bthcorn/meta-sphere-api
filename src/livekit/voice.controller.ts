import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LiveKitService } from './livekit.service';
import { CurrentUser } from 'src/auth/decorator/current-user.decorator';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

/** Fixed LiveKit room that every user in the campus common area joins. */
const LOBBY_ROOM = 'campus-lobby';

@ApiTags('voice')
@ApiBearerAuth('JWT-auth')
@Controller('voice')
export class VoiceController {
  constructor(private readonly liveKit: LiveKitService) {}

  @Get('lobby-token')
  @ApiOperation({ summary: 'Generate a LiveKit token for the global campus lobby' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        url: { type: 'string' },
      },
    },
  })
  async getLobbyToken(@CurrentUser() user: JwtUser) {
    const token = await this.liveKit.createToken(user.userId, user.username, LOBBY_ROOM);
    return { token, url: this.liveKit.getLiveKitPublicUrl() };
  }

  @Get('area-token')
  @ApiOperation({ summary: 'Generate a LiveKit token for a named area (library, chill zone, etc.)' })
  @ApiQuery({ name: 'roomId', required: true, description: 'The room UUID from ZONE_CONFIG' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        url: { type: 'string' },
      },
    },
  })
  async getAreaToken(
    @CurrentUser() user: JwtUser,
    @Query('roomId') roomId: string,
  ) {
    if (!roomId) throw new BadRequestException('roomId is required');
    const token = await this.liveKit.createToken(user.userId, user.username, `area-${roomId}`);
    return { token, url: this.liveKit.getLiveKitPublicUrl() };
  }
}
