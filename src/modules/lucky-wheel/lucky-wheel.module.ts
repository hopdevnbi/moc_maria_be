import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LuckyWheelController } from './lucky-wheel.controller';
import { LuckyWheelService } from './lucky-wheel.service';
@Module({
  imports: [AuthModule],
  controllers: [LuckyWheelController],
  providers: [LuckyWheelService],
})
export class LuckyWheelModule {}
