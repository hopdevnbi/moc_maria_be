import { Global, Module } from '@nestjs/common';
import { ZaloAlertsService } from './zalo-alerts.service';
import { ChatDigestService } from './chat-digest.service';
import { ChatDigestController } from './chat-digest.controller';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';

@Global()
@Module({
  imports: [AuthModule, AccessControlModule],
  controllers: [ChatDigestController],
  providers: [ZaloAlertsService, ChatDigestService],
  exports: [ZaloAlertsService, ChatDigestService],
})
export class ZaloAlertsModule {}
