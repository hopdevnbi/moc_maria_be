import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GiftEventsService } from './gift-events.service';
import { AdminGiftEventsController, PublicGiftEventsController } from './gift-events.controller';
import { GiftPrizesService } from './gift-prizes.service';
import { AdminGiftPrizesController, AdminGiftMediaController } from './gift-prizes.controller';
import { GiftEventMediaStorage } from './gift-event-media.storage';

@Module({
  imports: [AuthModule],
  controllers: [
    PublicGiftEventsController,
    AdminGiftEventsController,
    AdminGiftPrizesController,
    AdminGiftMediaController,
  ],
  providers: [GiftEventsService, GiftPrizesService, GiftEventMediaStorage],
  exports: [GiftEventsService],
})
export class GiftEventsModule {}
