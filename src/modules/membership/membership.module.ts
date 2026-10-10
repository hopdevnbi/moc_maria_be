import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { MembershipService } from './membership.service';
import { MembershipController, AdminMembershipController } from './membership.controller';

@Module({
  imports: [AuthModule, AccessControlModule],
  controllers: [MembershipController, AdminMembershipController],
  providers: [MembershipService],
})
export class MembershipModule {}
