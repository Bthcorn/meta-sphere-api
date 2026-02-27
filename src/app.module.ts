import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { PrismaModule } from './prisma/prisma.module';
import { RoomsModule } from './rooms/rooms.module';
import { RedisModule } from './redis/redis.module';
import { SessionsModule } from './sessions/sessions.module';
import { MessagesModule } from './messages/messages.module';
import { FilesModule } from './files/files.module';
import { AdminModule } from './admin/admin.module';
import { RolesGuard } from './common/guards/roles.guard';
import { FriendsModule } from './friends/friends.module';
import { RealtimeModule } from './realtime/realtime.module';
import JwtAccessGuard from './auth/decorator/jwt-access-auth.guard';
import { RealtimeGateway } from './realtime/realtime.gateway';

@Module({
  imports: [
    ConfigModule.forRoot(),
    RedisModule,
    AuthModule,
    UsersModule,
    PrismaModule,
    RoomsModule,
    SessionsModule,
    MessagesModule,
    FilesModule,
    AdminModule,
    FriendsModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: JwtAccessGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
