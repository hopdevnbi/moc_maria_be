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
import { INQUIRY_STATES, inquiryState, inquiryStateSql, type InquiryState } from './inquiry-state';
import type {
  AdminInquiryQueryDto,
  AdminReplyInquiryDto,
  AdminCreateInquiryDto,
  AdminArchiveInquiryDto,
} from './experience.dto';

type InquiryStatus = InquiryState;
type PublicInquiry = Omit<Inquiry, 'signature' | 'providerUserId'>;
export type AdminInquiry = Omit<PublicInquiry, 'status'> & {
  status: InquiryState;
  appointmentVersion: number | null;
  canManageStatus: boolean;
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
  counts: Record<InquiryStatus | 'ALL' | 'CONFIRMED' | 'IN_SERVICE' | 'COMPLETED', number> & {
    ARCHIVED: number;
  };
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
  appointmentStatus?: string | null;
  appointmentVersion?: number | null;
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
    const status = inquiryState(row.value, row.appointmentStatus);
    return {
      ...publicInquiry,
      status,
      appointmentVersion: row.appointmentVersion ?? null,
      canManageStatus: actor?.roles.includes('SUPER_ADMIN') ?? false,
      customerEmail: row.customerEmail,
      customerPhone: row.customerPhone,
      updatedAt: new Date(row.updatedAt).toISOString(),
      allowedActions: actor?.roles.includes('SUPER_ADMIN')
        ? INQUIRY_STATES.filter((v) => v !== status)
        : status === 'PENDING' && !row.value.appointmentId && !row.value.archivedAt
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
      LEFT JOIN appointments a ON a.id::text=m.value->>'appointmentId'
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
        confirmed: number;
        in_service: number;
        completed: number;
      }>
    >(
      `SELECT COUNT(*)::int AS "all",
        COUNT(*) FILTER (WHERE (${inquiryStateSql})='PENDING')::int AS pending,
        COUNT(*) FILTER (WHERE (${inquiryStateSql})='CONTACTED')::int AS contacted,
        COUNT(*) FILTER (WHERE (${inquiryStateSql})='DECLINED')::int AS declined,
        COUNT(*) FILTER (WHERE (${inquiryStateSql})='CANCELLED')::int AS cancelled,
        COUNT(*) FILTER (WHERE (${inquiryStateSql})='CONFIRMED')::int AS confirmed,
        COUNT(*) FILTER (WHERE (${inquiryStateSql})='IN_SERVICE')::int AS in_service,
        COUNT(*) FILTER (WHERE (${inquiryStateSql})='COMPLETED')::int AS completed
        ${base}`,
      [q],
    );
    const rows = await this.db.query<AdminInquiryRow[]>(
      `SELECT m.value, m.updated_at AS "updatedAt", a.status AS "appointmentStatus", a.version AS "appointmentVersion",
        u.email AS "customerEmail", u.phone AS "customerPhone"
       ${base} AND ($2::text IS NULL OR (${inquiryStateSql})=$2::text)
       ORDER BY m.updated_at DESC, m.key DESC LIMIT $3::int OFFSET $4::int`,
      [q, status, limit, (page - 1) * limit],
    );
    const statusCounts: AdminInquiryPage['counts'] = {
      ALL: Number(counts.all),
      PENDING: Number(counts.pending),
      CONTACTED: Number(counts.contacted),
      DECLINED: Number(counts.declined),
      CANCELLED: Number(counts.cancelled),
      CONFIRMED: Number(counts.confirmed ?? 0),
      IN_SERVICE: Number(counts.in_service ?? 0),
      COMPLETED: Number(counts.completed ?? 0),
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
      `SELECT m.value, m.updated_at AS "updatedAt", a.status AS "appointmentStatus", a.version AS "appointmentVersion",
        u.email AS "customerEmail", u.phone AS "customerPhone"
       FROM app_metadata m LEFT JOIN users u ON u.id::text=m.value->>'customerId'
       LEFT JOIN appointments a ON a.id::text=m.value->>'appointmentId'
       WHERE m.key=$1`,
      [inquiryKey(id)],
    );
    if (!row) throw new NotFoundException('Không tìm thấy yêu cầu.');
    const history = await this.db.query<AdminInquiryHistory[]>(
      `SELECT event, actor_user_id AS "actorUserId",
        COALESCE(metadata->>'status',metadata->>'next',CASE WHEN event='appointment.inquiry.provider_completed' THEN 'COMPLETED' END) AS status, metadata->>'reason' AS reason,
        created_at AS "createdAt"
       FROM audit_logs WHERE event IN
         ('appointment.inquiry.created','appointment.inquiry.updated','appointment.inquiry.admin_updated',
          'appointment.inquiry.admin_created','appointment.inquiry.admin_archived','appointment.inquiry.admin_restored',
          'appointment.inquiry.provider_completed','appointment.inquiry.provider_started',
          'appointment.inquiry.confirmed','appointment.inquiry.in_service','appointment.inquiry.completed',
          'appointment.inquiry.cancelled')
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
    if (!INQUIRY_STATES.includes(dto.status))
      throw new BadRequestException('Trạng thái cập nhật không hợp lệ.');
    if (!actor.roles.includes('SUPER_ADMIN') && !['CONTACTED', 'DECLINED'].includes(dto.status))
      throw new ForbiddenException('Chỉ Super Admin được điều chỉnh toàn bộ trạng thái yêu cầu.');
    const reason = dto.reason?.trim() || '';
    if (reason.length < 10 || reason.length > 500)
      throw new BadRequestException('Ghi chú cần từ 10 đến 500 ký tự.');
    if (dto.status === 'COMPLETED' && dto.servicePerformedConfirmed !== true)
      throw new BadRequestException('Cần xác nhận buổi chăm sóc đã thực sự hoàn thành.');
    await this.db.transaction(async (manager: EntityManager) => {
      // Reuse the same transaction advisory-lock key as customer/KTV replies.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [inquiryKey(id)]);
      const [row] = await manager.query<Array<{ value: Inquiry; updatedAt: Date }>>(
        'SELECT value,updated_at AS "updatedAt" FROM app_metadata WHERE key=$1 FOR UPDATE',
        [inquiryKey(id)],
      );
      if (!row) throw new NotFoundException('Không tìm thấy yêu cầu.');
      const isSuperAdmin = actor.roles.includes('SUPER_ADMIN');
      if (row.value.archivedAt && !isSuperAdmin)
        throw new ConflictException('Yêu cầu đã lưu trữ. Hãy khôi phục trước.');
      let appointment:
        { id: string; status: string; version: number; customer_user_id: string } | undefined;
      if (row.value.appointmentId) {
        if (!isSuperAdmin)
          throw new ForbiddenException('Chỉ Super Admin được điều chỉnh lịch đã xác nhận.');
        [appointment] = await manager.query<(typeof appointment)[]>(
          'SELECT id,status,version,customer_user_id FROM appointments WHERE id=$1::uuid FOR UPDATE',
          [row.value.appointmentId],
        );
        if (!appointment || appointment.customer_user_id !== row.value.customerId)
          throw new ConflictException(
            'Lịch liên kết không khớp; cần kiểm tra dữ liệu trước khi cập nhật.',
          );
        if (
          dto.expectedAppointmentVersion !== undefined &&
          appointment.version !== dto.expectedAppointmentVersion
        )
          throw new ConflictException('Lịch đã thay đổi. Hãy đóng cửa sổ và tải lại.');
      }
      const previousStatus = inquiryState(row.value, appointment?.status);
      if (dto.expectedStatus && previousStatus !== dto.expectedStatus)
        throw new ConflictException('Trạng thái đã thay đổi. Vui lòng tải lại.');
      if (
        dto.expectedUpdatedAt &&
        new Date(row.updatedAt).getTime() !== new Date(dto.expectedUpdatedAt).getTime()
      )
        throw new ConflictException('Yêu cầu vừa được cập nhật. Hãy đóng cửa sổ và tải lại.');
      if (!isSuperAdmin && previousStatus !== 'PENDING')
        throw new ConflictException('Yêu cầu đã được xử lý. Hãy tải lại trước khi cập nhật.');
      if (previousStatus === dto.status) return;
      const previousCompletionAt =
        row.value.providerCompletedAt || row.value.adminCompletedAt || null;
      if (appointment) {
        const target =
          dto.status === 'PENDING'
            ? 'REQUESTED'
            : dto.status === 'CONTACTED'
              ? 'ACCEPTED'
              : dto.status;
        if (['PENDING', 'CONTACTED', 'CONFIRMED', 'IN_SERVICE'].includes(dto.status)) {
          // Serialize reactivation with provider assignment checks; do not reopen over another active booking.
          await manager.query(
            `SELECT p.id FROM provider_applications p JOIN appointment_staff s ON s.provider_application_id=p.id
            WHERE s.appointment_id=$1::uuid ORDER BY p.id FOR UPDATE OF p`,
            [appointment.id],
          );
          const [collision] = await manager.query<Array<{ id: string }>>(
            `SELECT other.id FROM appointments other
            JOIN appointment_staff staff ON staff.appointment_id=other.id
            JOIN appointments current ON current.id=$1::uuid
            WHERE other.id<>current.id AND staff.provider_application_id IN
              (SELECT provider_application_id FROM appointment_staff WHERE appointment_id=current.id)
            AND other.status IN ('REQUESTED','ACCEPTED','CUSTOMER_CONFIRMED','CONFIRMED','CHECKED_IN','IN_SERVICE')
            AND (other.status<>'REQUESTED' OR other.request_expires_at>clock_timestamp())
            AND other.blocked_starts_at<current.blocked_ends_at AND other.blocked_ends_at>current.blocked_starts_at LIMIT 1`,
            [appointment.id],
          );
          if (collision)
            throw new ConflictException(
              'KTV đang có lịch khác trong khung giờ này. Hãy điều chỉnh lịch trùng trước khi mở lại.',
            );
        }
        await manager.query(
          `UPDATE appointments SET status=$2,version=version+1,updated_at=clock_timestamp()
          WHERE id=$1::uuid AND version=$3`,
          [appointment.id, target, appointment.version],
        );
        await manager.query(
          `INSERT INTO appointment_status_history(appointment_id,previous_status,next_status,actor_user_id,reason,metadata)
          VALUES($1::uuid,$2,$3,$4::uuid,$5,$6::jsonb)`,
          [
            appointment.id,
            appointment.status,
            target,
            actor.id,
            reason,
            JSON.stringify({
              inquiryId: id,
              superAdminOverride: true,
              servicePerformedConfirmed: dto.status === 'COMPLETED',
            }),
          ],
        );
        row.value.fulfillmentStatus = dto.status;
      } else {
        delete row.value.fulfillmentStatus;
      }
      row.value.status = dto.status;
      if (dto.status === 'COMPLETED') row.value.adminCompletedAt = new Date().toISOString();
      else {
        delete row.value.providerCompletedAt;
        delete row.value.adminCompletedAt;
      }
      await manager.query(
        `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
        [inquiryKey(id), JSON.stringify(row.value)],
      );
      await manager.save(AuditLog, {
        event: 'appointment.inquiry.admin_updated',
        actorUserId: actor.id,
        targetUserId: row.value.customerId,
        metadata: {
          inquiryId: id,
          previousStatus,
          status: dto.status,
          reason,
          previousCompletionAt,
          appointmentId: appointment?.id ?? null,
          superAdminOverride: isSuperAdmin,
          servicePerformedConfirmed: dto.status === 'COMPLETED',
        },
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
      if (row.value.appointmentId)
        throw new ConflictException(
          'Lịch đã được tạo. Không lưu trữ yêu cầu liên kết; hãy quản lý trong lịch chính thức.',
        );
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
