import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ChatGateway } from './chat.gateway';
import { MessagesService } from '../messages/messages.service';
import { MessagesController } from '../messages/messages.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { WsJwtGuard } from '../realtime/guards/ws-jwt.guard';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_TOKEN_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
  ],
  controllers: [MessagesController],
  providers: [ChatGateway, MessagesService, WsJwtGuard],
  exports: [MessagesService], // SessionsService needs this to clear cache on end
})
export class ChatModule {}
