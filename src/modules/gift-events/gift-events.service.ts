import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import {
  type EventAction,
  type GiftEventStatus,
  type CreateGiftEventDto,
  type UpdateGiftEventDto,
  normalizeGiftTiers,
  assertGiftTimeWindow,
  effectiveGiftStatus,
} from './gift-events.dto';

export type GiftEventView = {
  id: string;
  code: string;
  slug: string;
  title: string;
  description: string;
  heroUrl: string | null;
  termsText: string;
  termsVersion: number;
  status: GiftEventStatus;
  effectiveStatus: GiftEventStatus;
  startAt: string | null;
  endAt: string | null;
  serverNow: string;
  eligibleTiers: string[];
  budgetCapVnd: number;
  budgetReservedVnd: number;
  guaranteePrize: true;
  maxOpensPerUser: 1;
  version: number;
};

type DbCampaign = {
  id: string;
  code: string;
  slug: string;
  title: string;
  description: string;
  hero_url: string | null;
  terms_text: string;
  terms_version: number;
  status: GiftEventStatus;
  start_at: Date | null;
  end_at: Date | null;
  budget_cap_vnd: string;
  budget_reserved_vnd: string;
  version: number;
};

function publicProjection(row: DbCampaign, tiers: string[], now = new Date()): GiftEventView {
  return {
    id: row.id,
    code: row.code,
    slug: row.slug,
    title: row.title,
    description: row.description,
    heroUrl: row.hero_url,
    termsText: row.terms_text,
    termsVersion: Number(row.terms_version),
    status: row.status,
    effectiveStatus: effectiveGiftStatus(row.status, row.start_at, row.end_at, now),
    startAt: row.start_at ? new Date(row.start_at).toISOString() : null,
    endAt: row.end_at ? new Date(row.end_at).toISOString() : null,
    serverNow: now.toISOString(),
    eligibleTiers: tiers,
    budgetCapVnd: Number(row.budget_cap_vnd),
    budgetReservedVnd: Number(row.budget_reserved_vnd),
    guaranteePrize: true,
    maxOpensPerUser: 1,
    version: Number(row.version),
  };
}

@Injectable()
export class GiftEventsService {
  constructor(protected readonly db: DataSource) {}

  featureEnabled(): boolean {
    return process.env['GIFT_EVENTS_ENABLED'] === 'true';
  }
  requireEnabled(): void {
    if (!this.featureEnabled())
      throw new ServiceUnavailableException('Sự kiện đang chuẩn bị, chưa kích hoạt.');
  }
  requireAdmin(actor: AuthUserContext): void {
    if (
      !actor.roles.includes('SUPER_ADMIN') ||
      !actor.permissions.includes('admin.portal') ||
      !actor.isActive
    )
      throw new ForbiddenException('Chỉ Super Admin được quản lý sự kiện.');
  }
  protected async tiers(manager: EntityManager, id: string): Promise<string[]> {
    const rows = await manager.query<Array<{ tier_code: string }>>(
      'SELECT tier_code FROM gift_event_tiers WHERE event_id=$1::uuid ORDER BY tier_code',
      [id],
    );
    return rows.map((r) => r.tier_code);
  }
  protected async campaign(manager: EntityManager, id: string, lock = false): Promise<DbCampaign> {
    const [row] = await manager.query<DbCampaign[]>(
      `SELECT * FROM gift_event_campaigns WHERE id=$1::uuid${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!row) throw new NotFoundException('Không tìm thấy sự kiện.');
    return row;
  }
  protected async audit(
    manager: EntityManager,
    actor: AuthUserContext,
    eventId: string,
    action: string,
    reason: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO gift_event_admin_audit(event_id,actor_user_id,action,reason,before_snapshot,after_snapshot)
      VALUES($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6::jsonb)`,
      [
        eventId,
        actor.id,
        action,
        reason,
        JSON.stringify(before ?? null),
        JSON.stringify(after ?? null),
      ],
    );
  }
  async list(actor: AuthUserContext): Promise<GiftEventView[]> {
    this.requireAdmin(actor);
    this.requireEnabled();
    const rows = await this.db.query<DbCampaign[]>(
      'SELECT * FROM gift_event_campaigns ORDER BY created_at DESC LIMIT 100',
    );
    const items: GiftEventView[] = [];
    for (const row of rows)
      items.push(publicProjection(row, await this.tiers(this.db.manager, row.id)));
    return items;
  }
  async detail(actor: AuthUserContext, id: string): Promise<GiftEventView> {
    this.requireAdmin(actor);
    this.requireEnabled();
    const row = await this.campaign(this.db.manager, id);
    return publicProjection(row, await this.tiers(this.db.manager, id));
  }
  async current(): Promise<{
    campaign: GiftEventView | null;
    status: 'DISABLED' | 'NONE' | 'ACTIVE';
    serverNow: string;
  }> {
    const now = new Date();
    if (!this.featureEnabled())
      return { campaign: null, status: 'DISABLED', serverNow: now.toISOString() };
    const [row] = await this.db.query<DbCampaign[]>(`SELECT * FROM gift_event_campaigns
      WHERE status IN ('SCHEDULED','LIVE','PAUSED','ENDED')
      ORDER BY CASE status WHEN 'LIVE' THEN 0 WHEN 'SCHEDULED' THEN 1 WHEN 'PAUSED' THEN 2 ELSE 3 END,
      start_at DESC NULLS LAST LIMIT 1`);
    if (!row) return { campaign: null, status: 'NONE', serverNow: now.toISOString() };
    return {
      campaign: publicProjection(row, await this.tiers(this.db.manager, row.id), now),
      status: 'ACTIVE',
      serverNow: now.toISOString(),
    };
  }
  async create(actor: AuthUserContext, dto: CreateGiftEventDto): Promise<GiftEventView> {
    this.requireAdmin(actor);
    this.requireEnabled();
    let tiers: string[];
    try {
      tiers = normalizeGiftTiers(dto.eligibleTiers);
      assertGiftTimeWindow(dto.startAt ?? null, dto.endAt ?? null);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    let id: string;
    try {
      id = await this.db.transaction(async (m) => {
        const [row] = await m.query<Array<{ id: string }>>(
          `INSERT INTO gift_event_campaigns
        (code,slug,title,description,terms_text,hero_url,start_at,end_at,budget_cap_vnd,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10::uuid) RETURNING id`,
          [
            dto.code,
            dto.slug,
            dto.title.trim(),
            dto.description?.trim() || '',
            dto.termsText?.trim() || '',
            dto.heroUrl || null,
            dto.startAt || null,
            dto.endAt || null,
            dto.budgetCapVnd || 0,
            actor.id,
          ],
        );
        for (const tier of tiers)
          await m.query('INSERT INTO gift_event_tiers(event_id,tier_code) VALUES($1::uuid,$2)', [
            row.id,
            tier,
          ]);
        await this.audit(
          m,
          actor,
          row.id,
          'CREATED',
          'Khởi tạo bản nháp sự kiện',
          {},
          { code: dto.code, tiers },
        );
        return row.id;
      });
    } catch (e) {
      if (typeof e === 'object' && e !== null && 'code' in e && e.code === '23505')
        throw new ConflictException('Mã sự kiện hoặc đường dẫn đã tồn tại.');
      throw e;
    }
    return this.detail(actor, id);
  }
  async update(
    actor: AuthUserContext,
    id: string,
    dto: UpdateGiftEventDto,
  ): Promise<GiftEventView> {
    this.requireAdmin(actor);
    this.requireEnabled();
    await this.db.transaction(async (m) => {
      const row = await this.campaign(m, id, true);
      if (row.version !== dto.expectedVersion)
        throw new ConflictException('Cấu hình đã được cập nhật; hãy tải lại.');
      if (
        !['DRAFT', 'SCHEDULED'].includes(row.status) ||
        (row.status === 'SCHEDULED' && row.start_at && new Date(row.start_at) <= new Date())
      )
        throw new ConflictException(
          'Sự kiện đang diễn ra; không được sửa thể lệ/quỹ/hạng theo cách này.',
        );
      const tiers =
        dto.eligibleTiers !== undefined
          ? normalizeGiftTiers(dto.eligibleTiers)
          : await this.tiers(m, id);
      const startsAt = dto.startAt ?? (row.start_at ? new Date(row.start_at).toISOString() : null);
      const endsAt = dto.endAt ?? (row.end_at ? new Date(row.end_at).toISOString() : null);
      try {
        assertGiftTimeWindow(startsAt, endsAt);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const nextBudget = dto.budgetCapVnd ?? Number(row.budget_cap_vnd);
      if (nextBudget < Number(row.budget_reserved_vnd))
        throw new BadRequestException('Không thể giảm quỹ thấp hơn phần đã cam kết.');
      await m.query(
        `UPDATE gift_event_campaigns SET title=$2,description=$3,terms_text=$4,hero_url=$5,
        start_at=$6::timestamptz,end_at=$7::timestamptz,budget_cap_vnd=$8,version=version+1,
        terms_version=terms_version+CASE WHEN terms_text<>$4 THEN 1 ELSE 0 END,
        updated_at=clock_timestamp(),updated_by=$9::uuid WHERE id=$1::uuid`,
        [
          id,
          dto.title?.trim() ?? row.title,
          dto.description?.trim() ?? row.description,
          dto.termsText?.trim() ?? row.terms_text,
          dto.heroUrl ?? row.hero_url,
          startsAt,
          endsAt,
          nextBudget,
          actor.id,
        ],
      );
      if (dto.eligibleTiers !== undefined) {
        await m.query('DELETE FROM gift_event_tiers WHERE event_id=$1::uuid', [id]);
        for (const tier of tiers)
          await m.query('INSERT INTO gift_event_tiers(event_id,tier_code) VALUES($1::uuid,$2)', [
            id,
            tier,
          ]);
      }
      await this.audit(
        m,
        actor,
        id,
        'UPDATED',
        dto.reason,
        { version: row.version },
        { version: row.version + 1, eligibleTiers: tiers },
      );
    });
    return this.detail(actor, id);
  }
  async action(
    actor: AuthUserContext,
    id: string,
    action: EventAction,
    expectedVersion: number,
    reason: string,
  ): Promise<GiftEventView> {
    this.requireAdmin(actor);
    this.requireEnabled();
    await this.db.transaction(async (m) => {
      if (action === 'PUBLISH' || action === 'RESUME')
        await m.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('mocmaria.gift-event.active-slot',0))",
        );
      const row = await this.campaign(m, id, true);
      if (row.version !== expectedVersion)
        throw new ConflictException('Sự kiện đã thay đổi; hãy tải lại.');
      const now = new Date(),
        oldState = effectiveGiftStatus(row.status, row.start_at, row.end_at, now);
      let next: GiftEventStatus | undefined;
      if (action === 'PUBLISH') {
        if (row.status !== 'DRAFT') throw new ConflictException('Chỉ công bố bản nháp.');
        if (!row.start_at || !row.end_at || new Date(row.end_at) <= now)
          throw new BadRequestException('Lịch phải có ngày kết thúc trong tương lai.');
        if (!row.terms_text || row.terms_text.trim().length < 20)
          throw new BadRequestException('Cần điều lệ từ 20 ký tự.');
        if (Number(row.budget_cap_vnd) <= 0) throw new BadRequestException('Cần ngân sách tối đa.');
        const tiers = await this.tiers(m, id);
        if (!tiers.length) throw new BadRequestException('Cần ít nhất một hạng.');
        const [count] = await m.query<Array<{ n: number }>>(
          `SELECT COUNT(*)::int n FROM gift_event_prizes
          WHERE event_id=$1::uuid AND enabled AND kind<>'CASH_COUNTER' AND stock_total>stock_issued AND liability_vnd>=0`,
          [id],
        );
        if (!count?.n) throw new BadRequestException('Cần quà hợp lệ còn tồn trước khi công bố.');
        const [overlap] = await m.query<Array<{ id: string }>>(
          `SELECT id FROM gift_event_campaigns
          WHERE id<>$1::uuid AND status IN ('SCHEDULED','LIVE','PAUSED')
          AND start_at<$3::timestamptz AND end_at>$2::timestamptz LIMIT 1`,
          [id, row.start_at, row.end_at],
        );
        if (overlap) throw new ConflictException('Đã có sự kiện khác trùng thời gian hiển thị.');
        next = new Date(row.start_at) > now ? 'SCHEDULED' : 'LIVE';
      } else if (action === 'PAUSE') {
        if (!['LIVE', 'SCHEDULED'].includes(oldState))
          throw new ConflictException('Chỉ tạm dừng chiến dịch còn hiệu lực.');
        next = 'PAUSED';
      } else if (action === 'RESUME') {
        if (row.status !== 'PAUSED' || !row.end_at || new Date(row.end_at) <= now)
          throw new ConflictException('Sự kiện hết hạn/không tạm dừng; không thể tiếp tục.');
        next = row.start_at && new Date(row.start_at) > now ? 'SCHEDULED' : 'LIVE';
      } else if (action === 'END') {
        if (!['LIVE', 'PAUSED', 'SCHEDULED'].includes(row.status))
          throw new ConflictException('Không thể kết thúc trạng thái này.');
        next = 'ENDED';
      } else if (action === 'ARCHIVE') {
        if (oldState !== 'ENDED') throw new ConflictException('Chỉ lưu trữ sự kiện đã kết thúc.');
        next = 'ARCHIVED';
      }
      if (!next) throw new BadRequestException('Tác vụ không hợp lệ.');
      await m.query(
        `UPDATE gift_event_campaigns SET status=$2,version=version+1,
        pause_reason=$3,updated_by=$4::uuid,updated_at=clock_timestamp() WHERE id=$1::uuid`,
        [id, next, next === 'PAUSED' ? reason.trim() : null, actor.id],
      );
      await this.audit(m, actor, id, action, reason, { status: row.status }, { status: next });
    });
    return this.detail(actor, id);
  }
}
