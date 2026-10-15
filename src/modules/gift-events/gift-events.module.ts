import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GiftEventsService } from './gift-events.service';
import { AdminGiftEventsController, PublicGiftEventsController } from './gift-events.controller';
import { GiftPrizesService } from './gift-prizes.service';
import { AdminGiftPrizesController, AdminGiftMediaController } from './gift-prizes.controller';
import { GiftEventMediaStorage } from './gift-event-media.storage';
import { GiftOpenController } from './gift-open.controller';
import { GiftOpenService } from './gift-open.service';
import { GiftWalletController } from './gift-wallet.controller';
import { GiftWalletService } from './gift-wallet.service';
import { GiftRedeemController, GiftCounterAccessController } from './gift-redeem.controller';
import { GiftRedeemService } from './gift-redeem.service';
import { GiftReportController } from './gift-report.controller';
import { GiftReportService } from './gift-report.service';
import { GiftAbuseService } from './gift-abuse.service';
import { GiftVouchersAdminController } from './gift-vouchers-admin.controller';
import { GiftVouchersAdminService } from './gift-vouchers-admin.service';
import { GiftNotificationsService } from './gift-notifications.service';
import { GiftOperationsController } from './gift-operations.controller';
import { GiftOperationsService } from './gift-operations.service';

@Module({
  imports: [AuthModule],
  controllers: [
    PublicGiftEventsController,
    AdminGiftEventsController,
    AdminGiftPrizesController,
    AdminGiftMediaController,
    GiftOpenController,
    GiftWalletController,
    GiftRedeemController,
    GiftCounterAccessController,
    GiftReportController,
    GiftVouchersAdminController,
    GiftOperationsController,
  ],
  providers: [
    GiftEventsService,
    GiftPrizesService,
    GiftEventMediaStorage,
    GiftOpenService,
    GiftWalletService,
    GiftRedeemService,
    GiftReportService,
    GiftAbuseService,
    GiftVouchersAdminService,
    GiftNotificationsService,
    GiftOperationsService,
  ],
  exports: [GiftEventsService],
})
export class GiftEventsModule {}
