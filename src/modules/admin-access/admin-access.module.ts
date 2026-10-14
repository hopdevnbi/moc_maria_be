import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessService } from './admin-access.service';

@Module({
  imports: [AuthModule, AccessControlModule],
  controllers: [AdminAccessController],
  providers: [AdminAccessService],
})
export class AdminAccessModule {}
