import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { AuditLog } from '../identity/entities/audit-log.entity';
import type { Inquiry } from './experience.service';
import type { AdminInquiryQueryDto, AdminReplyInquiryDto } from './experience.dto';

type InquiryStatus = Inquiry['status'];
type PublicInquiry = Omit<Inquiry, 'signature' | 'providerUserId'>;
export type AdminInquiry = PublicInquiry & {
  customerEmail: string | null;
  customerPhone: string | null;
  updatedAt: string;
  allowedActions: Array<'CONTACTED' | 'DECLINED'>;
};
export interface AdminInquiryPage {
  items: AdminInquiry[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  counts: Record<InquiryStatus | 'ALL', number>;
}
export interface AdminInquiryHistory {
  event: string;
  actorUserId: string | null;
  status: InquiryStatus | null;
  reason: string | null;
  createdAt: Date;
}
export type AdminInquiryDetail = AdminInquiry & { history: AdminInquiryHistory[] };
interface AdminInquiryRow {
  value: Inquiry;
  updatedAt: Date | string;
  customerEmail: string | null;
  customerPhone: string | null;
}

const inquiryKey = (id: string): string => 'mocmaria.inquiry.' + id;
const inquiryIdPattern = /^[a-f0-9]{64}$/;

// Customer and KTV inquiries are persisted in app_metadata, not the inactive
// appointment booking tables. Admin management must operate on those records.
@Injectable()
export class AdminAppointmentInquiriesService {
  constructor(private readonly db: DataSource) {}

  private authorize(actor: AuthUserContext): void {
    if (
      !actor.permissions.includes(PERMISSIONS.CUSTOMER_MANAGE) ||
      !actor.roles.some((role) => role === 'ADMIN' || role === 'SUPER_ADMIN')
    ) {
      throw new ForbiddenException('Cần quyền quản trị khách hàng.');
    }
  }

  private present(row: AdminInquiryRow): AdminInquiry {
    const { signature: _signature, providerUserId: _providerUserId, ...publicInquiry } = row.value;
    return {
      ...publicInquiry,
      customerEmail: row.customerEmail,
      customerPhone: row.customerPhone,
      updatedAt: new Date(row.updatedAt).toISOString(),
      allowedActions: row.value.status === 'PENDING' ? ['CONTACTED', 'DECLINED'] : [],
    };
  }

  async list(actor: AuthUserContext, query: AdminInquiryQueryDto): Promise<AdminInquiryPage> {
    this.authorize(actor);
    const q = query.q?.trim() || null;
    const status = !query.status || query.status === 'ALL' ? null : query.status;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const base = `FROM app_metadata m
      LEFT JOIN users u ON u.id::text=m.value->>'customerId'
      WHERE m.key LIKE 'mocmaria.inquiry.%'
      AND ($1::text IS NULL OR
        POSITION(lower($1::text) IN lower(COALESCE(m.value->>'customerName',''))) > 0 OR
        POSITION(lower($1::text) IN lower(COALESCE(m.value->>'providerName',''))) > 0 OR
        POSITION(lower($1::text) IN lower(COALESCE(m.value->>'serviceName',''))) > 0 OR
        POSITION(lower($1::text) IN lower(COALESCE(m.value->>'address',''))) > 0 OR
        POSITION(lower($1::text) IN lower(COALESCE(u.email,''))) > 0 OR
        POSITION(lower($1::text) IN lower(COALESCE(u.phone,''))) > 0)`;
    const [counts] = await this.db.query<
      Array<{
        all: number;
        pending: number;
        contacted: number;
        declined: number;
        cancelled: number;
      }>
    >(
      `SELECT COUNT(*)::int AS "all",
        COUNT(*) FILTER (WHERE m.value->>'status'='PENDING')::int AS pending,
        COUNT(*) FILTER (WHERE m.value->>'status'='CONTACTED')::int AS contacted,
        COUNT(*) FILTER (WHERE m.value->>'status'='DECLINED')::int AS declined,
        COUNT(*) FILTER (WHERE m.value->>'status'='CANCELLED')::int AS cancelled
        ${base}`,
      [q],
    );
    const rows = await this.db.query<AdminInquiryRow[]>(
      `SELECT m.value, m.updated_at AS "updatedAt",
        u.email AS "customerEmail", u.phone AS "customerPhone"
       ${base} AND ($2::text IS NULL OR m.value->>'status'=$2::text)
       ORDER BY m.updated_at DESC, m.key DESC LIMIT $3::int OFFSET $4::int`,
      [q, status, limit, (page - 1) * limit],
    );
    const statusCounts: AdminInquiryPage['counts'] = {
      ALL: Number(counts.all),
      PENDING: Number(counts.pending),
      CONTACTED: Number(counts.contacted),
      DECLINED: Number(counts.declined),
      CANCELLED: Number(counts.cancelled),
    };
    const total = status ? statusCounts[status] : statusCounts.ALL;
    return {
      items: rows.map((row) => this.present(row)),
      page,
      limit,
      total,
      hasMore: page * limit < total,
      counts: statusCounts,
    };
  }

  async detail(actor: AuthUserContext, id: string): Promise<AdminInquiryDetail> {
    this.authorize(actor);
    if (!inquiryIdPattern.test(id)) throw new NotFoundException('Không tìm thấy yêu cầu.');
    const [row] = await this.db.query<AdminInquiryRow[]>(
      `SELECT m.value, m.updated_at AS "updatedAt",
        u.email AS "customerEmail", u.phone AS "customerPhone"
       FROM app_metadata m LEFT JOIN users u ON u.id::text=m.value->>'customerId'
       WHERE m.key=$1`,
      [inquiryKey(id)],
    );
    if (!row) throw new NotFoundException('Không tìm thấy yêu cầu.');
    const history = await this.db.query<AdminInquiryHistory[]>(
      `SELECT event, actor_user_id AS "actorUserId",
        metadata->>'status' AS status, metadata->>'reason' AS reason,
        created_at AS "createdAt"
       FROM audit_logs WHERE event IN
         ('appointment.inquiry.created','appointment.inquiry.updated','appointment.inquiry.admin_updated')
         AND metadata->>'inquiryId'=$1
       ORDER BY created_at DESC LIMIT 50`,
      [id],
    );
    return { ...this.present(row), history };
  }

  async update(
    actor: AuthUserContext,
    id: string,
    dto: AdminReplyInquiryDto,
  ): Promise<AdminInquiryDetail> {
    this.authorize(actor);
    if (!inquiryIdPattern.test(id)) throw new NotFoundException('Không tìm thấy yêu cầu.');
    if (dto.status !== 'CONTACTED' && dto.status !== 'DECLINED')
      throw new BadRequestException('Trạng thái cập nhật không hợp lệ.');
    const reason = dto.reason?.trim() || '';
    if (reason.length < 10 || reason.length > 500)
      throw new BadRequestException('Ghi chú cần từ 10 đến 500 ký tự.');
    await this.db.transaction(async (manager: EntityManager) => {
      // Reuse the same transaction advisory-lock key as customer/KTV replies.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [inquiryKey(id)]);
      const [row] = await manager.query<Array<{ value: Inquiry }>>(
        'SELECT value FROM app_metadata WHERE key=$1',
        [inquiryKey(id)],
      );
      if (!row) throw new NotFoundException('Không tìm thấy yêu cầu.');
      if (row.value.status !== 'PENDING')
        throw new ConflictException('Yêu cầu đã được xử lý. Hãy tải lại trước khi cập nhật.');
      row.value.status = dto.status;
      await manager.query(
        `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
        [inquiryKey(id), JSON.stringify(row.value)],
      );
      await manager.save(AuditLog, {
        event: 'appointment.inquiry.admin_updated',
        actorUserId: actor.id,
        targetUserId: row.value.customerId,
        metadata: { inquiryId: id, previousStatus: 'PENDING', status: dto.status, reason },
      });
    });
    return this.detail(actor, id);
  }
}
