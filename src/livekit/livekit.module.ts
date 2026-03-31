import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LiveKitService } from './livekit.service';

@Module({
  imports: [ConfigModule],
  providers: [LiveKitService],
  exports: [LiveKitService],
})
export class LiveKitModule {}
