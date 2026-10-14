import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { vipLevel } from '../../shared/membership/vip-level';
import {
  CustomerListQueryDto,
  UpdateCustomerNoteDto,
  UpdateCustomerVipDto,
} from './customer-management.dto';

type Tier = 'VIP' | 'STANDARD';

export interface CustomerSummary {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  birthday: string | null;
  avatarUrl: string | null;
  vipStatus: Tier;
  vipLevel: number | null;
  vipExpiresAt: string | null;
  inquiryCount: number;
  appointmentCount: number;
  completedCount: number;
  lastContactAt: Date | null;
}

export type VipRecord = {
  isVip: boolean;
  level?: number | null;
  expiresAt: string | null;
  startedAt: string | null;
  reason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

type CustomerRow = CustomerSummary & { vip: VipRecord | null; note: string | null };

export interface CustomerPage {
  items: CustomerSummary[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  counts: { all: number; vip: number; standard: number; active: number };
}

export interface CustomerInquiry {
  id: string;
  serviceName: string | null;
  status: string | null;
  createdAt: string;
}

export interface CustomerHistory {
  event: string;
  createdAt: Date;
  actorUserId: string | null;
  reason: string | null;
}

export type CustomerDetail = CustomerSummary & {
  note: string;
  vip: VipRecord;
  inquiries: CustomerInquiry[];
  history: CustomerHistory[];
};

const vipKey = (id: string): string => `mocmaria.customer.vip.${id}`;
const noteKey = (id: string): string => `mocmaria.customer.care.${id}`;
const activeVip = `COALESCE((
  vip.value->>'isVip' = 'true'
  AND (vip.value->>'expiresAt' IS NULL OR (vip.value->>'expiresAt')::timestamptz > clock_timestamp())
), false)`;

const customerFrom = `FROM users u
  LEFT JOIN customers c ON c.user_id=u.id
  LEFT JOIN app_metadata vip ON vip.key='mocmaria.customer.vip.' || u.id::text
  LEFT JOIN app_metadata care ON care.key='mocmaria.customer.care.' || u.id::text
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS inquiry_count, MAX(m.updated_at) AS last_inquiry_at
    FROM app_metadata m
    WHERE m.key LIKE 'mocmaria.inquiry.%' AND m.value->>'customerId'=u.id::text
  ) iq ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS appointment_count,
      COUNT(*) FILTER (WHERE a.status='COMPLETED')::int AS completed_count,
      MAX(a.updated_at) AS last_appointment_at
    FROM appointments a WHERE a.customer_user_id=u.id
  ) ap ON TRUE
  WHERE (c.id IS NOT NULL OR EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
    WHERE ur.user_id=u.id AND r.name='CUSTOMER'
  ))`;

const customerFields = `u.id, u.display_name AS "displayName", u.email, u.phone,
  u.is_active AS "isActive", u.created_at AS "createdAt",
  u.last_login_at AS "lastLoginAt", c.birthday::text AS birthday,
  c.avatar_url AS "avatarUrl",
  CASE WHEN ${activeVip} THEN 'VIP' ELSE 'STANDARD' END AS "vipStatus",
  CASE WHEN ${activeVip} THEN CASE WHEN vip.value->>'level' ~ '^[1-9][0-9]?$'
    THEN (vip.value->>'level')::int ELSE 1 END ELSE NULL END AS "vipLevel",
  vip.value->>'expiresAt' AS "vipExpiresAt",
  COALESCE(iq.inquiry_count,0)::int AS "inquiryCount",
  COALESCE(ap.appointment_count,0)::int AS "appointmentCount",
  COALESCE(ap.completed_count,0)::int AS "completedCount",
  NULLIF(GREATEST(COALESCE(iq.last_inquiry_at,'epoch'::timestamptz),
    COALESCE(ap.last_appointment_at,'epoch'::timestamptz)), 'epoch'::timestamptz) AS "lastContactAt"`;

const emptyVip: VipRecord = {
  isVip: false,
  level: null,
  expiresAt: null,
  startedAt: null,
  reason: null,
  updatedAt: null,
  updatedBy: null,
};

@Injectable()
export class CustomerManagementService {
  constructor(private readonly db: DataSource) {}

  private authorize(actor: AuthUserContext): void {
    if (
      !actor.permissions.includes(PERMISSIONS.CUSTOMER_MANAGE) ||
      !actor.roles.some((role) => role === 'ADMIN' || role === 'SUPER_ADMIN')
    ) {
      throw new ForbiddenException('Cần quyền quản trị khách hàng.');
    }
  }

  async list(actor: AuthUserContext, query: CustomerListQueryDto): Promise<CustomerPage> {
    this.authorize(actor);
    const q = query.q?.trim() || null;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const tier = query.tier ?? 'ALL';
    const status = query.status ?? 'ALL';
    const search = `AND ($1::text IS NULL OR
      POSITION(lower($1::text) IN lower(u.display_name))>0 OR
      POSITION(lower($1::text) IN lower(COALESCE(u.email,'')))>0 OR
      POSITION(lower($1::text) IN lower(COALESCE(u.phone,'')))>0)`;
    const [counts] = await this.db.query<
      Array<{ all: number; vip: number; standard: number; active: number }>
    >(
      `SELECT COUNT(*)::int AS "all",
        COUNT(*) FILTER (WHERE ${activeVip})::int AS vip,
        COUNT(*) FILTER (WHERE NOT ${activeVip})::int AS standard,
        COUNT(*) FILTER (WHERE u.is_active)::int AS active
      ${customerFrom} ${search}`,
      [q],
    );
    const filtered = `AND ($2::text='ALL' OR ($2::text='VIP' AND ${activeVip})
      OR ($2::text='STANDARD' AND NOT ${activeVip}))
      AND ($3::text='ALL' OR ($3::text='ACTIVE' AND u.is_active)
      OR ($3::text='INACTIVE' AND NOT u.is_active))`;
    const [totalRow] = await this.db.query<Array<{ total: number }>>(
      `SELECT COUNT(*)::int AS total ${customerFrom} ${search} ${filtered}`,
      [q, tier, status],
    );
    const items = await this.db.query<CustomerSummary[]>(
      `SELECT ${customerFields} ${customerFrom} ${search} ${filtered}
       ORDER BY u.created_at DESC, u.id DESC LIMIT $4::int OFFSET $5::int`,
      [q, tier, status, limit, (page - 1) * limit],
    );
    const total = Number(totalRow.total);
    return {
      items,
      page,
      limit,
      total,
      hasMore: page * limit < total,
      counts: {
        all: Number(counts.all),
        vip: Number(counts.vip),
        standard: Number(counts.standard),
        active: Number(counts.active),
      },
    };
  }

  async detail(actor: AuthUserContext, id: string): Promise<CustomerDetail> {
    this.authorize(actor);
    const [row] = await this.db.query<CustomerRow[]>(
      `SELECT ${customerFields}, vip.value AS vip,
        care.value->>'note' AS note ${customerFrom} AND u.id=$1::uuid`,
      [id],
    );
    if (!row) throw new NotFoundException('Không tìm thấy khách hàng.');

    const [inquiries, history] = await Promise.all([
      this.db.query<CustomerInquiry[]>(
        `SELECT m.value->>'id' AS id, m.value->>'serviceName' AS "serviceName",
          m.value->>'status' AS status, m.value->>'createdAt' AS "createdAt"
         FROM app_metadata m
         WHERE m.key LIKE 'mocmaria.inquiry.%' AND m.value->>'customerId'=$1
         ORDER BY m.updated_at DESC LIMIT 20`,
        [id],
      ),
      this.db.query<CustomerHistory[]>(
        `SELECT event, created_at AS "createdAt", actor_user_id AS "actorUserId",
          metadata->>'reason' AS reason
         FROM audit_logs WHERE target_user_id=$1::uuid
           AND event IN ('customer.vip.updated','customer.note.updated')
         ORDER BY created_at DESC LIMIT 30`,
        [id],
      ),
    ]);
    const { vip, note, ...summary } = row;
    return {
      ...summary,
      note: note || '',
      vip: { ...emptyVip, ...(vip ?? {}) },
      inquiries,
      history,
    };
  }

  private async lockCustomer(manager: EntityManager, id: string): Promise<void> {
    const [row] = await manager.query<Array<{ id: string }>>(
      `SELECT u.id FROM users u WHERE u.id=$1::uuid
       AND (EXISTS (SELECT 1 FROM customers c WHERE c.user_id=u.id)
         OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
           WHERE ur.user_id=u.id AND r.name='CUSTOMER')) FOR UPDATE`,
      [id],
    );
    if (!row) throw new NotFoundException('Không tìm thấy khách hàng.');
  }

  private saveMetadata(manager: EntityManager, key: string, value: object): Promise<unknown> {
    return manager.query(
      `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=clock_timestamp()`,
      [key, JSON.stringify(value)],
    );
  }

  async updateNote(
    actor: AuthUserContext,
    id: string,
    dto: UpdateCustomerNoteDto,
  ): Promise<CustomerDetail> {
    this.authorize(actor);
    const note = dto.note.trim();
    await this.db.transaction(async (manager) => {
      await this.lockCustomer(manager, id);
      await this.saveMetadata(manager, noteKey(id), {
        note,
        updatedAt: new Date().toISOString(),
        updatedBy: actor.id,
      });
      await manager.save(AuditLog, {
        event: 'customer.note.updated',
        actorUserId: actor.id,
        targetUserId: id,
        metadata: { operation: 'care_note_saved' },
      });
    });
    return this.detail(actor, id);
  }

  async updateVip(
    actor: AuthUserContext,
    id: string,
    dto: UpdateCustomerVipDto,
  ): Promise<CustomerDetail> {
    this.authorize(actor);
    const reason = dto.reason.trim();
    if (reason.length < 10 || reason.length > 500) {
      throw new BadRequestException('Lý do thay đổi VIP phải từ 10 đến 500 ký tự.');
    }
    if (dto.level != null && (!Number.isInteger(dto.level) || dto.level < 1 || dto.level > 99))
      throw new BadRequestException('Cấp VIP phải là số nguyên từ 1 đến 99.');
    const expiresAt = dto.isVip ? dto.expiresAt || null : null;
    if (
      expiresAt &&
      (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())
    ) {
      throw new BadRequestException('Ngày hết hạn VIP phải nằm trong tương lai.');
    }
    await this.db.transaction(async (manager) => {
      await this.lockCustomer(manager, id);
      const [existing] = await manager.query<Array<{ value: VipRecord }>>(
        'SELECT value FROM app_metadata WHERE key=$1 FOR UPDATE',
        [vipKey(id)],
      );
      const previous = existing?.value || emptyVip;
      const now = new Date().toISOString();
      const previousStillActive =
        previous.isVip && (!previous.expiresAt || Date.parse(previous.expiresAt) > Date.now());
      const level = dto.isVip ? (dto.level ?? vipLevel(previous.level)) : null;
      await this.saveMetadata(manager, vipKey(id), {
        isVip: dto.isVip,
        level,
        expiresAt,
        startedAt: dto.isVip ? (previousStillActive ? previous.startedAt || now : now) : null,
        reason,
        updatedAt: now,
        updatedBy: actor.id,
      } satisfies VipRecord);
      await manager.save(AuditLog, {
        event: 'customer.vip.updated',
        actorUserId: actor.id,
        targetUserId: id,
        metadata: {
          reason,
          previousVip: previous.isVip,
          newVip: dto.isVip,
          previousLevel: previous.isVip ? vipLevel(previous.level) : null,
          level,
          previousExpiresAt: previous.expiresAt,
          expiresAt,
        },
      });
    });
    return this.detail(actor, id);
  }
}
