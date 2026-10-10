import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KtvSafetyController } from './safety.controller';
import { KtvSafetyService } from './safety.service';
@Module({
  imports: [AuthModule],
  controllers: [KtvSafetyController],
  providers: [KtvSafetyService],
})
export class KtvSafetyModule {}
