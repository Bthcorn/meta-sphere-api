import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LiveKitModule } from 'src/livekit/livekit.module';

@Module({
  imports: [PrismaModule, LiveKitModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
