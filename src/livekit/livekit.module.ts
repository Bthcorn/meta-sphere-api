import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LiveKitService } from './livekit.service';
import { VoiceController } from './voice.controller';

@Module({
  imports: [ConfigModule],
  controllers: [VoiceController],
  providers: [LiveKitService],
  exports: [LiveKitService],
})
export class LiveKitModule {}
