import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProviderDisplayService } from './provider-display.service';
import {
  AdminProviderDisplayController,
  PublicProviderDisplayController,
} from './provider-display.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminProviderDisplayController, PublicProviderDisplayController],
  providers: [ProviderDisplayService],
  exports: [ProviderDisplayService],
})
export class ProviderDisplayModule {}
