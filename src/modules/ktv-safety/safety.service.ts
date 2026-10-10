import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { AuditLog } from '../identity/entities/audit-log.entity';
import type { Inquiry } from '../customer-experience/experience.service';
import type {
  SafetyActionDto,
  SafetyIncidentDto,
  SafetyPointDto,
  StartSafetyDto,
} from './safety.dto';
import {
  active,
  locationState,
  maintain,
  seal,
  unseal,
  type SafetySession,
  type SafetyVisit,
  type SafetyPoint,
} from './safety.model';
const prefix = 'mocmaria.safety.session.';
@Injectable()
export class KtvSafetyService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private sweeping = false;
  private lastSweep = 0;
  private readonly logger = new Logger(KtvSafetyService.name);
  constructor(private readonly db: DataSource) {}
  private key(): Buffer {
    const raw = process.env['KTV_SAFETY_ENCRYPTION_KEY'] || '';
    if (!/^[A-Za-z0-9+/]{43}=$/.test(raw) || Buffer.from(raw, 'base64').length !== 32)
      throw new ServiceUnavailableException(
        'Chế độ an toàn đang chờ cấu hình bảo mật. Vui lòng liên hệ quản trị.',
      );
    return Buffer.from(raw, 'base64');
  }
  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweep().catch(() =>
        this.logger.warn('Safety retention maintenance failed; retry scheduled.'),
      );
    }, 60000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  private provider(a: AuthUserContext): void {
    if (!a.roles.some((r) => r === 'THERAPIST' || r === 'DOCTOR_CONSULTANT'))
      throw new ForbiddenException('Chỉ KTV được sử dụng chế độ an toàn.');
  }
  private admin(a: AuthUserContext): void {
    if (!a.roles.includes('SUPER_ADMIN'))
      throw new ForbiddenException('Chỉ super admin được theo dõi an toàn KTV.');
  }
  private async lock(m: EntityManager, key: string): Promise<void> {
    await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  }
  private async read(m: EntityManager, id: string): Promise<SafetySession | undefined> {
    const [r] = await m.query<{ value: SafetySession }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [prefix + id],
    );
    return r?.value;
  }
  private async save(m: EntityManager, s: SafetySession): Promise<void> {
    await m.query(
      `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
      [prefix + s.id, JSON.stringify(s)],
    );
  }
  private async audit(
    m: EntityManager,
    a: AuthUserContext,
    event: string,
    s: SafetySession,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await m.save(AuditLog, {
      event: 'ktv.safety.' + event,
      actorUserId: a.id,
      targetUserId: s.providerUserId,
      metadata: { sessionId: s.id, ...extra },
    });
  }
  private visible(s: SafetySession): Record<string, unknown> {
    const clean = maintain(structuredClone(s)),
      { sealedVisit, sealedPoint, sos, ...v } = clean,
      key = this.key();
    return {
      ...v,
      locationState: locationState(clean),
      overdue: active(clean) && Date.parse(clean.expectedCheckAt) < Date.now(),
      visit: sealedVisit ? unseal<SafetyVisit>(sealedVisit, key, clean.id + ':visit') : null,
      point: sealedPoint ? unseal<SafetyPoint>(sealedPoint, key, clean.id + ':point') : null,
      sos: sos
        ? {
            ...sos,
            sealedPoint: undefined,
            point: sos.sealedPoint
              ? unseal<SafetyPoint>(sos.sealedPoint, key, clean.id + ':sos')
              : null,
          }
        : null,
    };
  }
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const rows = await this.db.query<{ key: string }[]>(
        `SELECT key FROM app_metadata WHERE key LIKE $1`,
        [prefix + '%'],
      );
      for (const row of rows)
        await this.db.transaction(async (m) => {
          await this.lock(m, row.key);
          const s = await this.read(m, row.key.slice(prefix.length));
          if (!s) return;
          const before = JSON.stringify(s);
          maintain(s);
          if (
            s.endedAt &&
            Date.now() - Date.parse(s.endedAt) > 7 * 86400000 &&
            (!s.sos || s.sos.status === 'RESOLVED')
          )
            await m.query('DELETE FROM app_metadata WHERE key=$1', [row.key]);
          else if (before !== JSON.stringify(s)) await this.save(m, s);
        });
      this.lastSweep = Date.now();
    } finally {
      this.sweeping = false;
    }
  }
  async own(a: AuthUserContext): Promise<unknown> {
    this.provider(a);
    this.key();
    if (Date.now() - this.lastSweep > 60000) await this.sweep();
    const rows = await this.db.query<{ value: SafetySession }[]>(
      `SELECT value FROM app_metadata WHERE key LIKE $1 AND value->>'providerUserId'=$2 ORDER BY updated_at DESC LIMIT 20`,
      [prefix + '%', a.id],
    );
    return rows.map((r) => this.visible(r.value));
  }
  async monitor(a: AuthUserContext): Promise<unknown> {
    this.admin(a);
    this.key();
    if (Date.now() - this.lastSweep > 60000) await this.sweep();
    const rows = await this.db.query<{ value: SafetySession }[]>(
      `SELECT value FROM app_metadata WHERE key LIKE $1 AND ((value->>'status' IN ('TRAVELLING','ARRIVED')) OR (value->'sos'->>'status' IN ('OPEN','ACKNOWLEDGED')) OR updated_at>clock_timestamp()-interval '24 hours') ORDER BY CASE WHEN value->'sos'->>'status'='OPEN' THEN 0 WHEN value->'sos'->>'status'='ACKNOWLEDGED' THEN 1 ELSE 2 END,updated_at DESC LIMIT 200`,
      [prefix + '%'],
    );
    await this.db.transaction(async (m) => {
      await this.lock(m, 'mocmaria.safety.access.' + a.id);
      const [recent] = await m.query<{ id: string }[]>(
        `SELECT id FROM audit_logs WHERE actor_user_id=$1 AND event='ktv.safety.monitor.read' AND created_at>clock_timestamp()-interval '1 minute' LIMIT 1`,
        [a.id],
      );
      if (!recent)
        await m.save(AuditLog, {
          event: 'ktv.safety.monitor.read',
          actorUserId: a.id,
          metadata: { sessionIds: rows.map((r) => r.value.id) },
        });
    });
    return {
      serverTime: new Date().toISOString(),
      sessions: rows.map((r) => this.visible(r.value)),
    };
  }
  async start(a: AuthUserContext, d: StartSafetyDto): Promise<unknown> {
    this.provider(a);
    const key = this.key(),
      now = Date.now(),
      expected = Date.parse(d.expectedCheckAt);
    if (!d.consent || expected < now + 60000 || expected > now + 8 * 3600000)
      throw new BadRequestException('Cần đồng ý chia sẻ và chọn giờ check-in trong 8 giờ tới.');
    return this.db.transaction(async (m) => {
      await this.lock(m, 'mocmaria.safety.provider.' + a.id);
      await this.lock(m, 'mocmaria.inquiry.' + d.inquiryId);
      const [r] = await m.query<{ value: Inquiry }[]>(
        'SELECT value FROM app_metadata WHERE key=$1',
        ['mocmaria.inquiry.' + d.inquiryId],
      );
      const q = r?.value;
      if (!q || q.providerUserId !== a.id)
        throw new NotFoundException('Không tìm thấy yêu cầu phục vụ.');
      if (q.location !== 'AT_HOME' || q.status !== 'CONTACTED')
        throw new BadRequestException('Chỉ bật an toàn cho yêu cầu tại nhà đã trao đổi với khách.');
      const [existing] = await m.query<{ value: SafetySession }[]>(
        `SELECT value FROM app_metadata WHERE key LIKE $1 AND value->>'providerUserId'=$2 AND value->>'status' IN ('TRAVELLING','ARRIVED') AND (value->>'expiresAt')::timestamptz>clock_timestamp() LIMIT 1`,
        [prefix + '%', a.id],
      );
      if (existing)
        throw new ConflictException(
          'Bạn đang có phiên an toàn. Hãy kết thúc phiên hiện tại trước.',
        );
      const s: SafetySession = {
        id: randomUUID(),
        providerUserId: a.id,
        providerName: a.displayName,
        inquiryId: q.id,
        consentVersion: '2026-10-v1',
        startedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 8 * 3600000).toISOString(),
        expectedCheckAt: new Date(expected).toISOString(),
        status: 'TRAVELLING',
        sharing: true,
      };
      s.sealedVisit = seal(
        { address: q.address, customerName: q.customerName, serviceName: q.serviceName },
        key,
        s.id + ':visit',
      );
      await this.save(m, s);
      await this.audit(m, a, 'started', s);
      return this.visible(s);
    });
  }
  private async change(
    a: AuthUserContext,
    id: string,
    admin: boolean,
    fn: (s: SafetySession, m: EntityManager) => Promise<void> | void,
  ): Promise<unknown> {
    if (admin) this.admin(a);
    else this.provider(a);
    this.key();
    return this.db.transaction(async (m) => {
      await this.lock(m, prefix + id);
      const s = await this.read(m, id);
      if (!s || (!admin && s.providerUserId !== a.id))
        throw new NotFoundException('Không tìm thấy phiên an toàn.');
      maintain(s);
      await fn(s, m);
      maintain(s);
      await this.save(m, s);
      return this.visible(s);
    });
  }
  async point(a: AuthUserContext, id: string, d: SafetyPointDto): Promise<unknown> {
    return this.change(a, id, false, (s) => {
      if (!active(s) || !s.sharing) throw new ConflictException('Chia sẻ vị trí đã dừng.');
      const now = Date.now(),
        taken = Date.parse(d.recordedAt);
      if (taken > now + 10000 || taken < now - 60000)
        throw new BadRequestException('Vị trí đã cũ. Hãy lấy vị trí GPS mới.');
      if (s.pointRecordedAt && taken <= Date.parse(s.pointRecordedAt)) return;
      if (s.pointRecordedAt && taken - Date.parse(s.pointRecordedAt) < 5000) return;
      const p: SafetyPoint = { ...d, receivedAt: new Date(now).toISOString() };
      s.sealedPoint = seal(p, this.key(), s.id + ':point');
      s.pointRecordedAt = d.recordedAt;
    });
  }
  async action(a: AuthUserContext, id: string, d: SafetyActionDto): Promise<unknown> {
    return this.change(a, id, false, async (s, m) => {
      if (!active(s)) throw new ConflictException('Phiên an toàn đã kết thúc.');
      if (d.action === 'PAUSE') s.sharing = false;
      if (d.action === 'RESUME') s.sharing = true;
      if (d.action === 'ARRIVED') {
        s.status = 'ARRIVED';
        s.expectedCheckAt = new Date(
          Math.min(Date.now() + (d.checkAfterMinutes || 120) * 60000, Date.parse(s.expiresAt)),
        ).toISOString();
      }
      if (d.action === 'FINISH' || d.action === 'STOP') {
        s.status = d.action === 'FINISH' ? 'FINISHED' : 'STOPPED';
        s.sharing = false;
        s.endedAt = new Date().toISOString();
      }
      if (d.action === 'SOS') {
        if (s.sos && s.sos.status !== 'RESOLVED') return;
        s.sos = { id: randomUUID(), status: 'OPEN', raisedAt: new Date().toISOString() };
        if (s.sealedPoint) {
          s.sos.sealedPoint = seal(
            unseal<SafetyPoint>(s.sealedPoint, this.key(), s.id + ':point'),
            this.key(),
            s.id + ':sos',
          );
          s.sos.pointRecordedAt = s.pointRecordedAt;
        }
      }
      await this.audit(m, a, d.action.toLowerCase(), s);
    });
  }
  async incident(a: AuthUserContext, id: string, d: SafetyIncidentDto): Promise<unknown> {
    return this.change(a, id, true, async (s, m) => {
      if (!s.sos || s.sos.id !== d.alertId || s.sos.status === 'RESOLVED')
        throw new ConflictException('Cảnh báo đã thay đổi. Hãy tải lại.');
      if (d.note.trim().length < 5) throw new BadRequestException('Cần ghi chú xử lý.');
      if (d.action === 'RESOLVE' && s.sos.status !== 'ACKNOWLEDGED')
        throw new ConflictException('Cần tiếp nhận và liên hệ KTV trước khi đóng cảnh báo.');
      s.sos.status = d.action === 'RESOLVE' ? 'RESOLVED' : 'ACKNOWLEDGED';
      s.sos.operatorId = a.id;
      s.sos.note = d.note.trim();
      if (d.action === 'RESOLVE') s.sos.resolvedAt = new Date().toISOString();
      else s.sos.acknowledgedAt = new Date().toISOString();
      await this.audit(m, a, 'sos.' + d.action.toLowerCase(), s, { alertId: d.alertId });
    });
  }
}
