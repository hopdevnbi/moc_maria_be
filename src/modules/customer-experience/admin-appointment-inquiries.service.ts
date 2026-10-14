import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID, createHash } from 'node:crypto';
import { PERMISSIONS } from '../identity/identity.constants';
import { KtvChatService } from '../ktv-chat/ktv-chat.service';
import type { AuthUserContext } from '../identity/identity.types';
import { AuditLog } from '../identity/entities/audit-log.entity';
import type { Inquiry } from './experience.service';
import type {
  AdminInquiryQueryDto,
  AdminReplyInquiryDto,
  AdminCreateInquiryDto,
  AdminArchiveInquiryDto,
} from './experience.dto';

type InquiryStatus = Inquiry['status'];
type PublicInquiry = Omit<Inquiry, 'signature' | 'providerUserId'>;
export type AdminInquiry = PublicInquiry & {
  customerEmail: string | null;
  customerPhone: string | null;
  updatedAt: string;
  allowedActions: InquiryStatus[];
};
export interface AdminInquiryPage {
  items: AdminInquiry[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  counts: Record<InquiryStatus | 'ALL', number> & { ARCHIVED: number };
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
  constructor(
    private readonly db: DataSource,
    private readonly chat: KtvChatService = {} as KtvChatService,
  ) {}

  private superAdmin(actor: AuthUserContext): void {
    this.authorize(actor);
    if (!actor.roles.includes('SUPER_ADMIN'))
      throw new ForbiddenException('Chỉ Super Admin được tạo, lưu trữ và mở lại yêu cầu.');
  }

  private authorize(actor: AuthUserContext): void {
    if (
      !actor.permissions.includes(PERMISSIONS.CUSTOMER_MANAGE) ||
      !actor.roles.some((role) => role === 'ADMIN' || role === 'SUPER_ADMIN')
    ) {
      throw new ForbiddenException('Cần quyền quản trị khách hàng.');
    }
  }

  private present(row: AdminInquiryRow, actor?: AuthUserContext): AdminInquiry {
    const { signature: _signature, providerUserId: _providerUserId, ...publicInquiry } = row.value;
    return {
      ...publicInquiry,
      customerEmail: row.customerEmail,
      customerPhone: row.customerPhone,
      updatedAt: new Date(row.updatedAt).toISOString(),
      allowedActions: actor?.roles.includes('SUPER_ADMIN')
        ? (['PENDING', 'CONTACTED', 'DECLINED', 'CANCELLED'] as InquiryStatus[]).filter(
            (v) => v !== row.value.status,
          )
        : row.value.status === 'PENDING'
          ? ['CONTACTED', 'DECLINED']
          : [],
    };
  }

  async list(actor: AuthUserContext, query: AdminInquiryQueryDto): Promise<AdminInquiryPage> {
    this.authorize(actor);
    const q = query.q?.trim() || null;
    const status = !query.status || query.status === 'ALL' ? null : query.status;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const archiveClause = query.archived === true ? 'IS NOT NULL' : 'IS NULL';
    const base = `FROM app_metadata m
      LEFT JOIN users u ON u.id::text=m.value->>'customerId'
      WHERE m.key LIKE 'mocmaria.inquiry.%'
      AND m.value->>'archivedAt' ${archiveClause}
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
      ARCHIVED: query.archived ? Number(counts.all) : 0,
    };
    const total = status ? statusCounts[status] : statusCounts.ALL;
    return {
      items: rows.map((row) => this.present(row, actor)),
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
         ('appointment.inquiry.created','appointment.inquiry.updated','appointment.inquiry.admin_updated',
          'appointment.inquiry.admin_created','appointment.inquiry.admin_archived','appointment.inquiry.admin_restored')
         AND metadata->>'inquiryId'=$1
       ORDER BY created_at DESC LIMIT 50`,
      [id],
    );
    return { ...this.present(row, actor), history };
  }

  async update(
    actor: AuthUserContext,
    id: string,
    dto: AdminReplyInquiryDto,
  ): Promise<AdminInquiryDetail> {
    this.authorize(actor);
    if (!inquiryIdPattern.test(id)) throw new NotFoundException('Không tìm thấy yêu cầu.');
    if (!['PENDING', 'CONTACTED', 'DECLINED', 'CANCELLED'].includes(dto.status))
      throw new BadRequestException('Trạng thái cập nhật không hợp lệ.');
    if (!actor.roles.includes('SUPER_ADMIN') && !['CONTACTED', 'DECLINED'].includes(dto.status))
      throw new ForbiddenException('Chỉ Super Admin được điều chỉnh toàn bộ trạng thái yêu cầu.');
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
      if (row.value.archivedAt)
        throw new ConflictException('Yêu cầu đã lưu trữ. Hãy khôi phục trước.');
      if (dto.expectedStatus && row.value.status !== dto.expectedStatus)
        throw new ConflictException('Trạng thái đã thay đổi. Vui lòng tải lại.');
      if (!actor.roles.includes('SUPER_ADMIN') && row.value.status !== 'PENDING')
        throw new ConflictException('Yêu cầu đã được xử lý. Hãy tải lại trước khi cập nhật.');
      if (row.value.status === dto.status) return;
      const previousStatus = row.value.status;
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
        metadata: { inquiryId: id, previousStatus, status: dto.status, reason },
      });
    });
    return this.detail(actor, id);
  }

  async create(actor: AuthUserContext, dto: AdminCreateInquiryDto): Promise<AdminInquiryDetail> {
    this.superAdmin(actor);
    if ((dto.reason?.trim().length ?? 0) < 10)
      throw new BadRequestException('Cần lý do tạo yêu cầu từ 10 ký tự.');
    const requested = new Date(dto.requestedAt);
    if (!Number.isFinite(requested.getTime()) || requested.getTime() <= Date.now())
      throw new BadRequestException('Chỉ tạo yêu cầu cho thời gian trong tương lai.');
    const providers = await this.chat.directory();
    const selected = providers.find((p) => p.id === dto.providerId);
    const service = selected?.services.find((s) => s.id === dto.serviceId);
    if (!selected || !service) throw new BadRequestException('KTV hoặc dịch vụ không khả dụng.');
    const id = createHash('sha256')
      .update('admin.inquiry.' + randomUUID())
      .digest('hex');
    await this.db.transaction(async (m) => {
      const [customer] = await m.query<Array<{ id: string; display_name: string }>>(
        `SELECT u.id,u.display_name FROM users u JOIN customers c ON c.user_id=u.id
         WHERE u.id=$1::uuid AND u.is_active FOR SHARE OF u`,
        [dto.customerId],
      );
      if (!customer) throw new BadRequestException('Khách hàng không tồn tại hoặc đã bị khóa.');
      const [ktv] = await m.query<Array<{ user_id: string }>>(
        `SELECT p.user_id FROM provider_applications p JOIN users u ON u.id=p.user_id
         WHERE p.id=$1::uuid AND u.is_active AND p.status NOT IN ('REJECTED','SUSPENDED')`,
        [dto.providerId],
      );
      if (!ktv) throw new BadRequestException('KTV đã ngừng hoạt động.');
      const record: Inquiry = {
        id,
        signature: createHash('sha256')
          .update(id + actor.id)
          .digest('hex'),
        customerId: customer.id,
        customerName: customer.display_name,
        providerId: dto.providerId,
        providerUserId: ktv.user_id,
        providerName: selected.publicName,
        serviceId: service.id,
        serviceName: service.name,
        region: 'Hà Nội',
        location: dto.location,
        address: dto.address.trim(),
        requestedAt: requested.toISOString(),
        notes: dto.notes?.trim() || '',
        createdAt: new Date().toISOString(),
        status: 'PENDING',
        createdByAdmin: true,
      };
      await m.query('INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)', [
        inquiryKey(id),
        JSON.stringify(record),
      ]);
      await m.save(AuditLog, {
        event: 'appointment.inquiry.admin_created',
        actorUserId: actor.id,
        targetUserId: customer.id,
        metadata: { inquiryId: id, reason: dto.reason.trim(), providerId: dto.providerId },
      });
    });
    return this.detail(actor, id);
  }

  async archive(
    actor: AuthUserContext,
    id: string,
    dto: AdminArchiveInquiryDto,
    archived: boolean,
  ): Promise<AdminInquiryDetail> {
    this.superAdmin(actor);
    if ((dto.reason?.trim().length ?? 0) < 10)
      throw new BadRequestException('Cần lý do xử lý từ 10 ký tự.');
    if (!inquiryIdPattern.test(id)) throw new NotFoundException('Không tìm thấy yêu cầu.');
    await this.db.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [inquiryKey(id)]);
      const [row] = await m.query<Array<{ value: Inquiry }>>(
        'SELECT value FROM app_metadata WHERE key=$1 FOR UPDATE',
        [inquiryKey(id)],
      );
      if (!row) throw new NotFoundException('Không tìm thấy yêu cầu.');
      if (!!row.value.archivedAt === archived)
        throw new ConflictException('Yêu cầu đã ở trạng thái này.');
      const next = {
        ...row.value,
        // Archiving an outstanding request must not leave an apparently live
        // request in the customer's portal. Restoration does not silently reopen it.
        status: archived ? ('CANCELLED' as const) : row.value.status,
        archivedAt: archived ? new Date().toISOString() : undefined,
      };
      await m.query(
        `UPDATE app_metadata SET value=$2::jsonb,updated_at=clock_timestamp() WHERE key=$1`,
        [inquiryKey(id), JSON.stringify(next)],
      );
      await m.save(AuditLog, {
        event: archived
          ? 'appointment.inquiry.admin_archived'
          : 'appointment.inquiry.admin_restored',
        actorUserId: actor.id,
        targetUserId: row.value.customerId,
        metadata: {
          inquiryId: id,
          reason: dto.reason.trim(),
          previousStatus: row.value.status,
          status: next.status,
        },
      });
    });
    return this.detail(actor, id);
  }
}
