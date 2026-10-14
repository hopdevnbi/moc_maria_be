import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { KtvChatModule } from '../ktv-chat/ktv-chat.module';
import { AdminIntakeController } from './admin-intake.controller';
import { AdminIntakeService } from './admin-intake.service';
@Module({
  imports: [AuthModule, AccessControlModule, KtvChatModule],
  providers: [AdminIntakeService],
  controllers: [AdminIntakeController],
})
export class AdminIntakeModule {}
