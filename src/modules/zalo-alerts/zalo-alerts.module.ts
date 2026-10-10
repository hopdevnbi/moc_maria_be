import { Global, Module } from '@nestjs/common';
import { ZaloAlertsService } from './zalo-alerts.service';

@Global()
@Module({ providers: [ZaloAlertsService], exports: [ZaloAlertsService] })
export class ZaloAlertsModule {}
