import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { WheelEngine, type WheelBetInput } from './wheel-engine';
// Fixed server-owned domain identity. Never supplied by a client or shared with Dconstruction.
export const MOC_WHEEL_SCOPE = '00000000-0000-4000-8000-000000000001';
@Injectable()
export class LuckyWheelService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LuckyWheelService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private stopped = false;
  private cached?: WheelEngine;
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}
  private engine(): WheelEngine {
    if (!this.config.get<boolean>('MOC_MARIA_WHEEL_ENABLED'))
      throw new NotFoundException('WHEEL_UNAVAILABLE');
    return (this.cached ??= new WheelEngine(
      this.db,
      Buffer.from(this.config.getOrThrow<string>('MOC_MARIA_WHEEL_RESULT_KEY'), 'base64url'),
    ));
  }
  state(user: AuthUserContext): ReturnType<WheelEngine['state']> {
    return this.engine().state(MOC_WHEEL_SCOPE, user.id);
  }
  bet(user: AuthUserContext, input: WheelBetInput): ReturnType<WheelEngine['bet']> {
    if (user.mustChangePassword) throw new ForbiddenException('WHEEL_PASSWORD_CHANGE_REQUIRED');
    return this.engine().bet(MOC_WHEEL_SCOPE, user.id, input, async (manager) => {
      const [current] = await manager.query<{ must_change_password: boolean }[]>(
        `SELECT u.must_change_password FROM public.users u JOIN public.refresh_sessions s ON s.user_id=u.id WHERE u.id=$1 AND u.is_active AND s.id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()`,
        [user.id, user.sessionId],
      );
      if (!current) throw new UnauthorizedException('Account session is unavailable.');
      if (current.must_change_password)
        throw new ForbiddenException('WHEEL_PASSWORD_CHANGE_REQUIRED');
    });
  }
  onApplicationBootstrap(): void {
    if (this.config.get<boolean>('MOC_MARIA_WHEEL_ENABLED')) this.schedule(300);
  }
  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick();
    }, ms);
    this.timer.unref();
  }
  private async tick(): Promise<void> {
    let delay = 1000;
    try {
      await this.engine().settleDue();
    } catch {
      this.logger.warn('MOC_WHEEL_SETTLEMENT_RETRY');
      delay = 5000;
    } finally {
      this.schedule(delay);
    }
  }
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}
