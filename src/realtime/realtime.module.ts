import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { StateService } from './state.service';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [JwtModule, ConfigModule],
  providers: [StateService, RealtimeGateway],
})
export class RealtimeModule {}
