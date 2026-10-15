import { Injectable, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { GiftEventsService } from './gift-events.service';
import type { AuthUserContext } from '../identity/identity.types';

export type GiftEventAction = 'OPEN' | 'ISSUE_QR' | 'VERIFY' | 'REDEEM';
const limits: Record<GiftEventAction, { limit: number; windowMs: number }> = {
  OPEN: { limit: 12, windowMs: 600_000 },
  ISSUE_QR: { limit: 8, windowMs: 300_000 },
  VERIFY: { limit: 30, windowMs: 300_000 },
  REDEEM: { limit: 20, windowMs: 300_000 },
};

/** A single SQL upsert acts as the atomic rate-limit decision across replicas. */
@Injectable()
export class GiftAbuseService {
  constructor(
    private readonly db: DataSource,
    private readonly events: GiftEventsService,
  ) {}
  async consume(actor: AuthUserContext, action: GiftEventAction, scope: string): Promise<void> {
    this.events.requireEnabled();
    if (!actor.id || scope.length > 100 || !scope || !limits[action])
      throw new BadRequestException('INVALID_EVENT_REQUEST');
    const { limit, windowMs } = limits[action];
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    const [allowed] = await this.db.query<Array<{ attempts: number }>>(
      `INSERT INTO gift_event_rate_limits
      (actor_user_id,action,scope,window_start,attempts)
      VALUES($1::uuid,$2,$3,$4,1)
      ON CONFLICT(actor_user_id,action,scope,window_start)
      DO UPDATE SET attempts=gift_event_rate_limits.attempts+1
      WHERE gift_event_rate_limits.attempts<$5
      RETURNING attempts`,
      [actor.id, action, scope, windowStart, limit],
    );
    if (!allowed) throw new HttpException('EVENT_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
  }
}
