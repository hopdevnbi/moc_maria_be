import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GiftEventsService } from './gift-events.service';
import { AdminGiftEventsController, PublicGiftEventsController } from './gift-events.controller';

@Module({
  imports: [AuthModule],
  controllers: [PublicGiftEventsController, AdminGiftEventsController],
  providers: [GiftEventsService],
  exports: [GiftEventsService],
})
export class GiftEventsModule {}
