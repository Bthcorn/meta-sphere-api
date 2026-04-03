import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SessionFilesGateway } from './session-files.gateway';
import { FilesModule } from '../files/files.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MinioModule } from '../minio/minio.module';
import { WsJwtGuard } from '../realtime/guards/ws-jwt.guard';

@Module({
  imports: [
    PrismaModule,
    MinioModule,
    FilesModule, // provides FilesService (exported)
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
  providers: [SessionFilesGateway, WsJwtGuard],
})
export class SessionFilesModule {}
