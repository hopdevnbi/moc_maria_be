import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ReferralRiskRetentionService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(ReferralRiskRetentionService.name);
  constructor(private readonly db: DataSource) {}
  onModuleInit(): void {
    if (process.env['NODE_ENV'] === 'test') return;
    this.timer = setInterval(() => void this.expire(), 3600000);
    this.timer.unref?.();
    void this.expire();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  async expire(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.db.transaction(async (m) => {
        const [lock] = await m.query<{ locked: boolean }[]>(
          "SELECT pg_try_advisory_xact_lock(hashtext('moc-referral-retention')) AS locked",
        );
        if (!lock?.locked) return;
        await m.query(`WITH stale AS (SELECT id FROM referrals WHERE created_at<now()-interval '30 days'
          AND (device_hash IS NOT NULL OR network_hash IS NOT NULL) ORDER BY created_at LIMIT 1000 FOR UPDATE SKIP LOCKED)
          UPDATE referrals r SET device_hash=NULL,network_hash=NULL FROM stale WHERE r.id=stale.id`);
        await m.query(`WITH stale AS (SELECT user_id FROM referral_verification_challenges WHERE requested_at<now()-interval '2 days'
          ORDER BY requested_at LIMIT 1000 FOR UPDATE SKIP LOCKED)
          DELETE FROM referral_verification_challenges v USING stale WHERE v.user_id=stale.user_id`);
      });
    } catch {
      this.logger.warn('Referral retention cleanup failed; retry on next interval');
    } finally {
      this.running = false;
    }
  }
}
