import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProviderWorkspaceController } from './provider-workspace.controller';
import { ProviderWorkspaceService } from './provider-workspace.service';
@Module({
  imports: [AuthModule],
  controllers: [ProviderWorkspaceController],
  providers: [ProviderWorkspaceService],
})
export class ProviderWorkspaceModule {}
