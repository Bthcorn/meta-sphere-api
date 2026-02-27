import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { CurrentUser } from 'src/auth/decorator/current-user.decorator';
import type { JwtUser } from 'src/auth/interfaces/jwt-user.interface';

@ApiTags('friends')
@ApiBearerAuth('JWT-auth')
@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  @ApiOperation({ summary: 'List all accepted friends' })
  @ApiResponse({ status: 200, description: 'Accepted friends returned.' })
  listFriends(@CurrentUser() user: JwtUser) {
    return this.friendsService.listFriends(user.userId);
  }

  @Get('requests')
  @ApiOperation({ summary: 'List pending incoming friend requests' })
  @ApiResponse({ status: 200, description: 'Pending requests returned.' })
  listPendingRequests(@CurrentUser() user: JwtUser) {
    return this.friendsService.listPendingRequests(user.userId);
  }

  @Post('request/:userId')
  @ApiOperation({ summary: 'Send a friend request' })
  @ApiResponse({ status: 201, description: 'Friend request sent.' })
  @ApiResponse({ status: 400, description: 'Cannot send request to yourself.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ApiResponse({ status: 409, description: 'Request or friendship already exists.' })
  sendRequest(
    @CurrentUser() user: JwtUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.friendsService.sendRequest(user.userId, userId);
  }

  @Post('accept/:requestId')
  @ApiOperation({ summary: 'Accept a friend request' })
  @ApiResponse({ status: 200, description: 'Friend request accepted.' })
  @ApiResponse({ status: 400, description: 'Request is no longer pending.' })
  @ApiResponse({ status: 403, description: 'Not the request addressee.' })
  @ApiResponse({ status: 404, description: 'Friend request not found.' })
  acceptRequest(
    @CurrentUser() user: JwtUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.friendsService.acceptRequest(user.userId, requestId);
  }

  @Post('decline/:requestId')
  @ApiOperation({ summary: 'Decline a friend request' })
  @ApiResponse({ status: 200, description: 'Friend request declined.' })
  @ApiResponse({ status: 400, description: 'Request is no longer pending.' })
  @ApiResponse({ status: 403, description: 'Not the request addressee.' })
  @ApiResponse({ status: 404, description: 'Friend request not found.' })
  declineRequest(
    @CurrentUser() user: JwtUser,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.friendsService.declineRequest(user.userId, requestId);
  }

  @Delete(':userId')
  @ApiOperation({ summary: 'Remove a friend' })
  @ApiResponse({ status: 200, description: 'Friend removed.' })
  @ApiResponse({ status: 404, description: 'Friendship not found.' })
  removeFriend(
    @CurrentUser() user: JwtUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.friendsService.removeFriend(user.userId, userId);
  }
}
