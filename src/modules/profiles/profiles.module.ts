import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { StaffAvatarStorage } from './staff-avatar-storage';

@Module({
  imports: [IdentityModule, AuthModule, AccessControlModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, StaffAvatarStorage],
})
export class ProfilesModule {}
