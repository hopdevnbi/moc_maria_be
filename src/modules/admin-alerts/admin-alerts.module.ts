import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { AdminAlertRecipient } from './admin-alert-recipient.entity';
import { AdminAlertsController } from './admin-alerts.controller';
import { AdminAlertsService } from './admin-alerts.service';

@Global()
@Module({
  imports: [AuthModule, AccessControlModule, TypeOrmModule.forFeature([AdminAlertRecipient])],
  controllers: [AdminAlertsController],
  providers: [AdminAlertsService],
  exports: [AdminAlertsService],
})
export class AdminAlertsModule {}
