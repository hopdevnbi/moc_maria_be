import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import type { Inquiry } from '../customer-experience/experience.service';
import { ConfirmInquiryDto, ChangeFulfillmentDto } from './inquiry-fulfillment.dto';

type Stage = 'CONFIRMED' | 'IN_SERVICE' | 'COMPLETED' | 'CANCELLED';
type Audience = 'ADMIN' | 'PROVIDER';
type InquiryWithFulfillment = Inquiry & { appointmentId?: string; fulfillmentStatus?: Stage };
type AppointmentRow = {
  id: string;
  status: Stage;
  version: number;
  starts_at: Date;
  ends_at: Date;
  customer_user_id: string;
};

export type FulfillmentView = {
  inquiryId: string;
  providerName: string;
  customerName: string;
  serviceName: string;
  appointmentId: string | null;
  status: Stage | null;
  version: number | null;
  startsAt: string | null;
  endsAt: string | null;
  canConfirm: boolean;
  history: Array<{
    previousStatus: string | null;
    nextStatus: string;
    reason: string;
    createdAt: string;
  }>;
};

const validInquiryId = /^[0-9a-f]{64}$/;
const metadataKey = (id: string): string => `mocmaria.inquiry.${id}`;
const allowed: Record<Stage, Stage[]> = {
  CONFIRMED: ['IN_SERVICE', 'CANCELLED', 'COMPLETED'],
  IN_SERVICE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
const json = (v: unknown): string => JSON.stringify(v);

@Injectable()
export class InquiryFulfillmentService {
  constructor(private readonly db: DataSource) {}

  private authorize(
    actor: AuthUserContext,
    audience: Audience,
    inquiry?: InquiryWithFulfillment,
  ): void {
    if (audience === 'ADMIN') {
      if (
        !actor.roles.includes('SUPER_ADMIN') ||
        !actor.permissions.includes(PERMISSIONS.CUSTOMER_MANAGE)
      )
        throw new ForbiddenException('Chỉ Super Admin được xác nhận hoặc điều chỉnh lịch.');
    } else if (
      !actor.roles.some((r) => r === 'THERAPIST' || r === 'DOCTOR_CONSULTANT') ||
      (inquiry !== undefined && inquiry.providerUserId !== actor.id)
    ) {
      throw new ForbiddenException('Chỉ KTV được phân công mới được báo tiến độ phục vụ.');
    }
  }

  private async inquiry(
    manager: EntityManager,
    id: string,
    lock: boolean,
  ): Promise<InquiryWithFulfillment> {
    if (!validInquiryId.test(id)) throw new NotFoundException('Không tìm thấy yêu cầu đặt lịch.');
    if (lock)
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        metadataKey(id),
      ]);
    const [row] = await manager.query<Array<{ value: InquiryWithFulfillment }>>(
      `SELECT value FROM app_metadata WHERE key=$1${lock ? ' FOR UPDATE' : ''}`,
      [metadataKey(id)],
    );
    if (!row?.value || row.value.id !== id)
      throw new NotFoundException('Không tìm thấy yêu cầu đặt lịch.');
    return row.value;
  }

  private async appointment(
    manager: EntityManager,
    value: InquiryWithFulfillment,
    lock: boolean,
  ): Promise<AppointmentRow | null> {
    if (!value.appointmentId) return null;
    const [row] = await manager.query<AppointmentRow[]>(
      `SELECT id,status,version,starts_at,ends_at,customer_user_id FROM appointments WHERE id=$1::uuid${lock ? ' FOR UPDATE' : ''}`,
      [value.appointmentId],
    );
    if (!row || row.customer_user_id !== value.customerId)
      throw new ConflictException(
        'Lịch chính thức không khớp khách hàng; cần quản trị viên kiểm tra.',
      );
    return row;
  }

  private async makeView(
    manager: EntityManager,
    value: InquiryWithFulfillment,
    stage?: AppointmentRow | null,
  ): Promise<FulfillmentView> {
    const appt = stage === undefined ? await this.appointment(manager, value, false) : stage;
    const history = appt
      ? await manager.query<
          Array<{
            previousStatus: string | null;
            nextStatus: string;
            reason: string;
            createdAt: Date;
          }>
        >(
          `SELECT previous_status AS "previousStatus",next_status AS "nextStatus",reason,created_at AS "createdAt"
       FROM appointment_status_history WHERE appointment_id=$1::uuid ORDER BY created_at,id`,
          [appt.id],
        )
      : [];
    return {
      inquiryId: value.id,
      providerName: value.providerName,
      customerName: value.customerName,
      serviceName: value.serviceName,
      appointmentId: appt?.id ?? null,
      status: appt?.status ?? null,
      version: appt?.version ?? null,
      startsAt: appt?.starts_at ? new Date(appt.starts_at).toISOString() : null,
      endsAt: appt?.ends_at ? new Date(appt.ends_at).toISOString() : null,
      canConfirm: !value.appointmentId && value.status === 'CONTACTED' && !value.archivedAt,
      history: history.map((h) => ({ ...h, createdAt: new Date(h.createdAt).toISOString() })),
    };
  }

  async detail(actor: AuthUserContext, id: string, audience: Audience): Promise<FulfillmentView> {
    this.authorize(actor, audience);
    return this.db.transaction(async (manager) => {
      const inquiry = await this.inquiry(manager, id, false);
      this.authorize(actor, audience, inquiry);
      return this.makeView(manager, inquiry);
    });
  }

  async assigned(actor: AuthUserContext): Promise<FulfillmentView[]> {
    if (!actor.roles.some((r) => r === 'THERAPIST' || r === 'DOCTOR_CONSULTANT'))
      throw new ForbiddenException('Cần tài khoản KTV.');
    return this.db.transaction(async (manager) => {
      const rows = await manager.query<Array<{ value: InquiryWithFulfillment }>>(
        `SELECT value FROM app_metadata WHERE key LIKE 'mocmaria.inquiry.%'
         AND value->>'providerUserId'=$1 AND value->>'appointmentId' IS NOT NULL
         ORDER BY updated_at DESC LIMIT 50`,
        [actor.id],
      );
      const views: FulfillmentView[] = [];
      for (const row of rows) views.push(await this.makeView(manager, row.value));
      return views;
    });
  }

  async confirm(
    actor: AuthUserContext,
    inquiryId: string,
    dto: ConfirmInquiryDto,
  ): Promise<FulfillmentView> {
    this.authorize(actor, 'ADMIN');
    const startsAt = new Date(dto.startsAt),
      endsAt = new Date(dto.endsAt),
      now = new Date();
    if (!dto.customerAgreementConfirmed)
      throw new BadRequestException('Cần xác nhận khách và KTV đã thống nhất lịch phục vụ.');
    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      startsAt >= endsAt ||
      endsAt.getTime() - startsAt.getTime() > 12 * 3600_000
    )
      throw new BadRequestException('Thời gian bắt đầu/kết thúc không hợp lệ (tối đa 12 giờ).');
    if (startsAt < now && !dto.historicalBookingConfirmed)
      throw new BadRequestException('Lịch đã qua cần xác nhận rõ đây là dịch vụ lịch sử.');
    if (startsAt.getTime() > now.getTime() + 366 * 86_400_000)
      throw new BadRequestException('Không xác nhận lịch quá một năm tới.');
    return this.db.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        metadataKey(inquiryId),
      ]);
      const inquiry = await this.inquiry(manager, inquiryId, true);
      if (inquiry.archivedAt || inquiry.status !== 'CONTACTED' || inquiry.appointmentId)
        throw new ConflictException(
          'Yêu cầu không ở trạng thái Đang trao đổi hoặc đã có lịch chính thức.',
        );
      if (inquiry.location !== 'AT_BRANCH')
        throw new BadRequestException(
          'Lịch phục vụ tại nhà cần cấu hình địa chỉ định vị và phí di chuyển trong booking core.',
        );
      const [branch, second] = await manager.query<Array<{ id: string }>>(
        'SELECT id FROM branches WHERE is_active=true ORDER BY created_at LIMIT 2',
      );
      if (!branch || second)
        throw new BadRequestException(
          'Cần có đúng một cơ sở hoạt động để xác nhận lịch; hãy cấu hình cơ sở.',
        );
      const [parties] = await manager.query<Array<{ customer_ok: boolean; provider_ok: boolean }>>(
        `SELECT EXISTS(SELECT 1 FROM users u JOIN customers c ON c.user_id=u.id
            WHERE u.id=$1::uuid AND u.is_active) AS customer_ok,
          EXISTS(SELECT 1 FROM provider_applications p JOIN users u ON u.id=p.user_id
            WHERE p.id=$2::uuid AND u.id=$3::uuid AND u.is_active AND p.status NOT IN('REJECTED','SUSPENDED')) AS provider_ok`,
        [inquiry.customerId, inquiry.providerId, inquiry.providerUserId],
      );
      if (!parties?.customer_ok || !parties.provider_ok)
        throw new ConflictException('Khách hoặc KTV đã ngừng hoạt động; không thể chốt lịch.');
      // A provider-scoped lock serializes all manual bookings and protects against
      // two admins assigning overlapping appointments at the same time.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `provider.booking.${inquiry.providerId}`,
      ]);
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `customer.booking.${inquiry.customerId}`,
      ]);
      const [conflict] = await manager.query<Array<{ id: string }>>(
        `SELECT a.id FROM appointments a JOIN appointment_staff s ON s.appointment_id=a.id
         WHERE s.provider_application_id=$1::uuid AND a.status IN
           ('REQUESTED','ACCEPTED','CUSTOMER_CONFIRMED','CONFIRMED','CHECKED_IN','IN_SERVICE','COMPLETED')
           AND a.blocked_starts_at<$3::timestamptz AND a.blocked_ends_at>$2::timestamptz LIMIT 1`,
        [inquiry.providerId, startsAt.toISOString(), endsAt.toISOString()],
      );
      if (conflict)
        throw new ConflictException('KTV đã có lịch khác trùng giờ; không thể xác nhận.');
      const [customerConflict] = await manager.query<Array<{ id: string }>>(
        `SELECT a.id FROM appointments a WHERE a.customer_user_id=$1::uuid
          AND a.status IN ('REQUESTED','ACCEPTED','CUSTOMER_CONFIRMED','CONFIRMED','CHECKED_IN','IN_SERVICE','COMPLETED')
          AND a.blocked_starts_at<$3::timestamptz AND a.blocked_ends_at>$2::timestamptz LIMIT 1`,
        [inquiry.customerId, startsAt.toISOString(), endsAt.toISOString()],
      );
      if (customerConflict)
        throw new ConflictException('Khách hàng đã có lịch khác trùng giờ; không thể xác nhận.');
      const fingerprint = createHash('sha256')
        .update(inquiryId + startsAt.toISOString() + endsAt.toISOString())
        .digest('hex');
      const [appointment] = await manager.query<Array<AppointmentRow>>(
        `INSERT INTO appointments(customer_user_id,created_by,branch_id,mode,status,starts_at,ends_at,
           blocked_starts_at,blocked_ends_at,request_expires_at,current_quote_revision,
           idempotency_key,request_fingerprint,version,source,notes,destination)
         VALUES($1::uuid,$2::uuid,$3::uuid,'AT_BRANCH','CONFIRMED',$4::timestamptz,$5::timestamptz,
           $4::timestamptz,$5::timestamptz,$5::timestamptz,1,$6,$7,1,'ADMIN',$8,NULL)
         RETURNING id,status,version,starts_at,ends_at,customer_user_id`,
        [
          inquiry.customerId,
          actor.id,
          branch.id,
          startsAt.toISOString(),
          endsAt.toISOString(),
          `inq:${inquiryId.slice(0, 60)}`,
          fingerprint,
          `Yêu cầu ${inquiryId.slice(0, 12)} - ${inquiry.serviceName}`.slice(0, 500),
        ],
      );
      // The legacy seeded service is not a published catalog UUID yet: do NOT invent
      // appointment_items, prices, payment quotes or qualification certificates.
      await manager.query(
        'INSERT INTO appointment_staff(appointment_id,provider_application_id) VALUES($1::uuid,$2::uuid)',
        [appointment.id, inquiry.providerId],
      );
      await this.history(manager, appointment.id, null, 'CONFIRMED', actor.id, dto.reason, {
        intakeId: inquiryId,
        serviceId: inquiry.serviceId,
        serviceName: inquiry.serviceName,
        manualLegacyIntake: true,
        customerAgreementConfirmed: true,
        historicalBookingConfirmed: dto.historicalBookingConfirmed === true,
        catalogVariantPending: true,
      });
      inquiry.appointmentId = appointment.id;
      inquiry.fulfillmentStatus = 'CONFIRMED';
      await manager.query(
        'UPDATE app_metadata SET value=$2::jsonb,updated_at=clock_timestamp() WHERE key=$1',
        [metadataKey(inquiryId), json(inquiry)],
      );
      await manager.save(AuditLog, {
        event: 'appointment.inquiry.booking_confirmed',
        actorUserId: actor.id,
        targetUserId: inquiry.customerId,
        metadata: { inquiryId, appointmentId: appointment.id, reason: dto.reason },
      });
      return this.makeView(manager, inquiry, appointment);
    });
  }

  private async history(
    manager: EntityManager,
    appointmentId: string,
    previous: Stage | null,
    next: Stage,
    actorId: string,
    reason: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO appointment_status_history(appointment_id,previous_status,next_status,actor_user_id,reason,metadata)
       VALUES($1::uuid,$2,$3,$4::uuid,$5,$6::jsonb)`,
      [appointmentId, previous, next, actorId, reason.trim(), json(metadata)],
    );
  }

  async change(
    actor: AuthUserContext,
    inquiryId: string,
    dto: ChangeFulfillmentDto,
    audience: Audience,
  ): Promise<FulfillmentView> {
    this.authorize(actor, audience);
    if (audience === 'PROVIDER' && dto.status === 'CANCELLED')
      throw new ForbiddenException('KTV cần liên hệ quản trị viên để hủy lịch đã xác nhận.');
    return this.db.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        metadataKey(inquiryId),
      ]);
      const inquiry = await this.inquiry(manager, inquiryId, true);
      this.authorize(actor, audience, inquiry);
      const current = await this.appointment(manager, inquiry, true);
      if (!current)
        throw new ConflictException('Hãy xác nhận lịch chính thức trước khi bắt đầu phục vụ.');
      if (current.version !== dto.expectedVersion)
        throw new ConflictException('Lịch vừa được người khác cập nhật. Hãy tải lại.');
      if (
        !(allowed[current.status] ?? []).includes(dto.status) ||
        (audience === 'PROVIDER' && current.status === 'CONFIRMED' && dto.status === 'COMPLETED')
      )
        throw new ConflictException('Không thể chuyển trạng thái lịch theo thứ tự này.');
      if (dto.status === 'COMPLETED') {
        if (!dto.servicePerformedConfirmed)
          throw new BadRequestException(
            'Cần xác nhận dịch vụ thực sự đã hoàn thành trước khi mở đánh giá.',
          );
        if (new Date(current.ends_at).getTime() > Date.now())
          throw new BadRequestException('Lịch chưa đến giờ kết thúc; hãy kiểm tra giờ phục vụ.');
      }
      if (
        dto.status === 'IN_SERVICE' &&
        audience === 'PROVIDER' &&
        Date.now() < new Date(current.starts_at).getTime() - 30 * 60_000
      )
        throw new BadRequestException(
          'Lịch chưa đến giờ phục vụ; KTV chỉ có thể bắt đầu sớm tối đa 30 phút.',
        );
      const [updated] = await manager.query<AppointmentRow[]>(
        `WITH changed AS (UPDATE appointments SET status=$2,version=version+1,updated_at=clock_timestamp()
         WHERE id=$1::uuid AND version=$3 AND status=$4
         RETURNING id,status,version,starts_at,ends_at,customer_user_id)
         SELECT * FROM changed`,
        [current.id, dto.status, dto.expectedVersion, current.status],
      );
      if (!updated) throw new ConflictException('Lịch thay đổi đồng thời; hãy tải lại.');
      await this.history(manager, current.id, current.status, dto.status, actor.id, dto.reason, {
        inquiryId,
        servicePerformedConfirmed: dto.status === 'COMPLETED',
        actorRole: audience,
        legacyManualBooking: true,
      });
      inquiry.fulfillmentStatus = dto.status;
      if (dto.status === 'CANCELLED') inquiry.status = 'CANCELLED';
      await manager.query(
        'UPDATE app_metadata SET value=$2::jsonb,updated_at=clock_timestamp() WHERE key=$1',
        [metadataKey(inquiryId), json(inquiry)],
      );
      await manager.save(AuditLog, {
        event: `appointment.inquiry.${dto.status.toLowerCase()}`,
        actorUserId: actor.id,
        targetUserId: inquiry.customerId,
        metadata: {
          inquiryId,
          appointmentId: current.id,
          previous: current.status,
          next: dto.status,
          reason: dto.reason,
        },
      });
      return this.makeView(manager, inquiry, updated);
    });
  }
}
