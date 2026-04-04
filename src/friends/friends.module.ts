import { Module } from '@nestjs/common';
import { FriendsService } from './friends.service';
import { FriendsController } from './friends.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PresenceModule } from 'src/presence/presence.module';

@Module({
  imports: [PrismaModule, PresenceModule],
  controllers: [FriendsController],
  providers: [FriendsService],
})
export class FriendsModule {}
