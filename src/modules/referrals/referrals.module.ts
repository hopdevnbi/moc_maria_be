import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';
import { ReferralVerificationService } from './referral-verification.service';
import { ReferralRiskRetentionService } from './referral-risk-retention.service';

@Module({
  imports: [AuthModule],
  controllers: [ReferralsController],
  providers: [ReferralsService, ReferralVerificationService, ReferralRiskRetentionService],
})
export class ReferralsModule {}
