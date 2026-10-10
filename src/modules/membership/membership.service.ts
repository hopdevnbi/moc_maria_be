import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  VipMemberStatusDto,
  VipRequestDto,
  VipReviewDto,
  VipSettingsDto,
} from './dto/vip.dto';

type VipStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
interface VipSettingsRow {
  id: number;
  displayName: string;
  description: string;
  benefits: string[];
  acceptingRequests: boolean;
  durationDays: number | null;
}
interface VipRequestRow {
  id: string;
  customerUserId: string;
  status: VipStatus;
  note: string | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  createdAt: Date;
}
interface VipMembershipRow {
  customerUserId: string;
  status: 'ACTIVE' | 'SUSPENDED';
  activeSince: Date;
  expiresAt: Date | null;
}
const SETTINGS_SQL = `SELECT id, display_name AS "displayName", description, benefits,
  accepting_requests AS "acceptingRequests", duration_days AS "durationDays"
  FROM vip_membership_settings WHERE id=1`;
const REQUEST_SQL = `SELECT id, customer_user_id AS "customerUserId", status, note,
  review_note AS "reviewNote", reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt",
  created_at AS "createdAt" FROM vip_membership_requests`;
const MEMBER_SQL = `SELECT customer_user_id AS "customerUserId", status,
  active_since AS "activeSince", expires_at AS "expiresAt" FROM vip_memberships`;

export function effectiveVipStatus(
  membership: VipMembershipRow | undefined,
  pending: VipRequestRow | undefined,
  at = new Date(),
): 'STANDARD' | 'PENDING' | 'VIP' | 'EXPIRED' | 'SUSPENDED' {
  if (membership?.status === 'ACTIVE' && (!membership.expiresAt || membership.expiresAt > at))
    return 'VIP';
  if (pending?.status === 'PENDING') return 'PENDING';
  if (membership?.status === 'SUSPENDED') return 'SUSPENDED';
  if (membership?.expiresAt && membership.expiresAt <= at) return 'EXPIRED';
  return 'STANDARD';
}
export function normalizedLimit(raw?: string): number {
  if (!raw) return 30;
  if (!/^\d{1,3}$/.test(raw)) throw new BadRequestException('Invalid limit');
  return Math.max(1, Math.min(Number(raw), 100));
}

@Injectable()
export class MembershipService {
  constructor(private readonly database: DataSource) {}

  async settings(): Promise<VipSettingsRow> {
    const rows = await this.database.query<VipSettingsRow[]>(SETTINGS_SQL);
    const config = rows[0];
    if (!config) throw new NotFoundException('VIP settings are not initialized.');
    return config;
  }

  async getMe(userId: string): Promise<unknown> {
    const [settings, membership, requests] = await Promise.all([
      this.settings(),
      this.database.query<VipMembershipRow[]>(MEMBER_SQL + ' WHERE customer_user_id=$1', [userId]),
      this.database.query<VipRequestRow[]>(
        REQUEST_SQL + ' WHERE customer_user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
        [userId],
      ),
    ]);
    const active = membership[0];
    const request = requests[0];
    return {
      tier: effectiveVipStatus(active, request) === 'VIP' ? 'VIP' : 'STANDARD',
      status: effectiveVipStatus(active, request),
      membership: active || null,
      request: request || null,
      settings,
    };
  }

  async request(userId: string, dto: VipRequestDto): Promise<unknown> {
    const note = dto.note?.trim() || null;
    try {
      return await this.database.transaction(async (manager) => {
        const customer = await manager.query<Array<{ id: string }>>(
          'SELECT id FROM customers WHERE user_id=$1',
          [userId],
        );
        if (!customer.length) throw new ForbiddenException('Customer profile is required.');
        const existing = await manager.query<VipRequestRow[]>(
          REQUEST_SQL + " WHERE customer_user_id=$1 AND status='PENDING' LIMIT 1",
          [userId],
        );
        if (existing[0]) return existing[0];
        const [cfg] = await manager.query<VipSettingsRow[]>(SETTINGS_SQL);
        if (!cfg?.acceptingRequests)
          throw new ConflictException('VIP registration is temporarily closed.');
        const [member] = await manager.query<VipMembershipRow[]>(
          MEMBER_SQL + ' WHERE customer_user_id=$1',
          [userId],
        );
        if (effectiveVipStatus(member, undefined) === 'VIP')
          throw new ConflictException('You are already an active VIP member.');
        const [created] = await manager.query<VipRequestRow[]>(
          `INSERT INTO vip_membership_requests(customer_user_id,note)
            VALUES ($1,$2) RETURNING id,customer_user_id AS "customerUserId",status,note,
            review_note AS "reviewNote",reviewed_by AS "reviewedBy",reviewed_at AS "reviewedAt",created_at AS "createdAt"`,
          [userId, note],
        );
        await manager.query(
          "INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata) VALUES ('VIP_REQUESTED',$1,$1,$2::jsonb)",
          [userId, JSON.stringify({ requestId: created.id })],
        );
        return created;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        const existing = await this.database.query<VipRequestRow[]>(
          REQUEST_SQL + " WHERE customer_user_id=$1 AND status='PENDING' LIMIT 1",
          [userId],
        );
        if (existing[0]) return existing[0];
      }
      throw error;
    }
  }

  async adminRequests(status?: string, limitRaw?: string): Promise<unknown> {
    if (status && !['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(status))
      throw new BadRequestException('Unknown VIP request status.');
    const limit = normalizedLimit(limitRaw);
    const rows = await this.database.query<
      Array<VipRequestRow & { displayName: string; email: string | null; phone: string | null }>
    >(
      `SELECT r.id,r.customer_user_id AS "customerUserId",r.status,r.note,
        r.review_note AS "reviewNote",r.reviewed_by AS "reviewedBy",
        r.reviewed_at AS "reviewedAt",r.created_at AS "createdAt",
        u.display_name AS "displayName",u.email,u.phone
        FROM vip_membership_requests r JOIN users u ON u.id=r.customer_user_id
        WHERE ($1::varchar IS NULL OR r.status=$1)
        ORDER BY r.created_at DESC,r.id DESC LIMIT $2`,
      [status || null, limit],
    );
    return { items: rows, limit };
  }

  async adminCustomers(q?: string, limitRaw?: string): Promise<unknown> {
    if (q && q.length > 80) throw new BadRequestException('Search query too long.');
    const limit = normalizedLimit(limitRaw);
    const rows = await this.database.query<Array<Record<string, unknown>>>(
      `SELECT u.id,u.display_name AS "displayName",u.email,u.phone,
        u.is_active AS "isActive",u.created_at AS "createdAt",
        c.birthday, c.avatar_url AS "avatarUrl",
        vm.status AS "membershipStatus",vm.expires_at AS "membershipExpiresAt"
        FROM customers c JOIN users u ON u.id=c.user_id
        LEFT JOIN vip_memberships vm ON vm.customer_user_id=u.id
        WHERE ($1::text IS NULL OR position(lower($1) in lower(
          concat_ws(' ',u.display_name,u.email,u.phone)))>0)
        ORDER BY u.created_at DESC,u.id DESC LIMIT $2`,
      [q?.trim() || null, limit],
    );
    return { items: rows, limit };
  }

  async adminMembers(limitRaw?: string): Promise<unknown> {
    const limit = normalizedLimit(limitRaw);
    const rows = await this.database.query<Array<Record<string, unknown>>>(
      `SELECT m.customer_user_id AS "customerUserId",m.status,
        m.active_since AS "activeSince",m.expires_at AS "expiresAt",
        u.display_name AS "displayName",u.email,u.phone
        FROM vip_memberships m JOIN users u ON u.id=m.customer_user_id
        ORDER BY m.updated_at DESC,m.customer_user_id DESC LIMIT $1`,
      [limit],
    );
    return { items: rows, limit };
  }

  async review(actorId: string, id: string, dto: VipReviewDto): Promise<unknown> {
    return this.database.transaction(async (manager) => {
      const [record] = await manager.query<VipRequestRow[]>(
        REQUEST_SQL + ' WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!record) throw new NotFoundException('VIP request not found.');
      if (record.status !== 'PENDING')
        throw new ConflictException('VIP request was already reviewed.');
      const [customer] = await manager.query<Array<{ id: string; isActive: boolean }>>(
        'SELECT c.id,u.is_active AS "isActive" FROM customers c JOIN users u ON u.id=c.user_id WHERE c.user_id=$1',
        [record.customerUserId],
      );
      if (!customer?.isActive) throw new ConflictException('Customer is not active.');
      const note = dto.reason.trim();
      if (dto.decision === 'APPROVE') {
        const [cfg] = await manager.query<VipSettingsRow[]>(SETTINGS_SQL);
        if (!cfg) throw new NotFoundException('VIP settings missing.');
        const [previous] = await manager.query<VipMembershipRow[]>(
          MEMBER_SQL + ' WHERE customer_user_id=$1 FOR UPDATE',
          [record.customerUserId],
        );
        if (effectiveVipStatus(previous, undefined) === 'VIP')
          throw new ConflictException('Customer is already an active VIP.');
        await manager.query(
          `INSERT INTO vip_memberships
           (customer_user_id,status,active_since,expires_at,approved_by,approved_request_id)
           VALUES ($1,'ACTIVE',clock_timestamp(),
              CASE WHEN $4::integer IS NULL THEN NULL ELSE clock_timestamp()+make_interval(days=>$4) END,$2,$3)
           ON CONFLICT(customer_user_id) DO UPDATE SET status='ACTIVE',active_since=excluded.active_since,
             expires_at=excluded.expires_at,approved_by=excluded.approved_by,
             approved_request_id=excluded.approved_request_id,updated_at=clock_timestamp()`,
          [record.customerUserId, actorId, record.id, cfg.durationDays],
        );
      }
      const [updated] = await manager.query<VipRequestRow[]>(
        `UPDATE vip_membership_requests SET status=$2,reviewed_by=$3,review_note=$4,
           reviewed_at=clock_timestamp(),updated_at=clock_timestamp()
           WHERE id=$1 RETURNING id,customer_user_id AS "customerUserId",status,note,
           review_note AS "reviewNote",reviewed_by AS "reviewedBy",reviewed_at AS "reviewedAt",created_at AS "createdAt"`,
        [id, dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', actorId, note],
      );
      await manager.query(
        'INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata) VALUES ($1,$2,$3,$4::jsonb)',
        [
          dto.decision === 'APPROVE' ? 'VIP_APPROVED' : 'VIP_REJECTED',
          actorId,
          record.customerUserId,
          JSON.stringify({ requestId: id, reason: note }),
        ],
      );
      return updated;
    });
  }

  async setMemberStatus(
    actorId: string,
    userId: string,
    dto: VipMemberStatusDto,
  ): Promise<unknown> {
    return this.database.transaction(async (manager) => {
      const [member] = await manager.query<VipMembershipRow[]>(
        MEMBER_SQL + ' WHERE customer_user_id=$1 FOR UPDATE',
        [userId],
      );
      if (!member) throw new NotFoundException('VIP member not found.');
      if (dto.status === 'ACTIVE' && member.expiresAt && member.expiresAt <= new Date())
        throw new ConflictException('Expired VIP membership must be reapproved.');
      await manager.query(
        'UPDATE vip_memberships SET status=$2,updated_at=clock_timestamp() WHERE customer_user_id=$1',
        [userId, dto.status],
      );
      await manager.query(
        'INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata) VALUES ($1,$2,$3,$4::jsonb)',
        [
          'VIP_STATUS_CHANGED',
          actorId,
          userId,
          JSON.stringify({ before: member.status, after: dto.status, reason: dto.reason.trim() }),
        ],
      );
      return { customerUserId: userId, status: dto.status };
    });
  }

  async updateSettings(actorId: string, dto: VipSettingsDto): Promise<unknown> {
    if (
      dto.benefits &&
      (dto.benefits.length > 10 ||
        dto.benefits.some(
          (item) => typeof item !== 'string' || item.trim().length < 3 || item.length > 180,
        ))
    )
      throw new BadRequestException('Benefits must contain up to 10 items, 3-180 characters each.');
    const data = {
      displayName: dto.displayName?.trim(),
      description: dto.description?.trim(),
      benefits: dto.benefits?.map((item) => item.trim()),
      acceptingRequests: dto.acceptingRequests,
      durationDays: dto.durationDays,
    };
    return this.database.transaction(async (manager) => {
      await manager.query(
        `UPDATE vip_membership_settings SET
           display_name=COALESCE($1,display_name),
           description=COALESCE($2,description),
           benefits=COALESCE($3::jsonb,benefits),
           accepting_requests=COALESCE($4,accepting_requests),
           duration_days=CASE WHEN $7::boolean THEN $5::integer ELSE duration_days END,
           updated_by=$6,updated_at=clock_timestamp() WHERE id=1`,
        [
          data.displayName ?? null,
          data.description ?? null,
          data.benefits ? JSON.stringify(data.benefits) : null,
          data.acceptingRequests ?? null,
          data.durationDays ?? null,
          actorId,
          Object.prototype.hasOwnProperty.call(dto, 'durationDays'),
        ],
      );
      await manager.query(
        "INSERT INTO audit_logs(event,actor_user_id,metadata) VALUES ('VIP_SETTINGS_UPDATED',$1,$2::jsonb)",
        [actorId, JSON.stringify({ changedFields: Object.keys(dto) })],
      );
      const [config] = await manager.query<VipSettingsRow[]>(SETTINGS_SQL);
      return config;
    });
  }
}
