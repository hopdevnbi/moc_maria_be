import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvChatService } from '../ktv-chat/ktv-chat.service';
import { AuditLog } from '../identity/entities/audit-log.entity';
import type {
  CreateInquiryDto,
  ReviewPresentationDto,
  SubmitPresentationDto,
  ReplyInquiryDto,
} from './experience.dto';

export interface Presentation {
  providerId: string;
  publicName: string;
  introduction: string | null;
  published?: { introduction: string; approvedAt: string };
  revision?: {
    id: string;
    introduction: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    submittedAt: string;
    note?: string;
  };
}
export interface Inquiry {
  id: string;
  customerId: string;
  customerName: string;
  providerId: string;
  providerUserId: string;
  providerName: string;
  serviceId: string;
  serviceName: string;
  region: 'Hà Nội';
  location: 'AT_BRANCH' | 'AT_HOME';
  address: string;
  requestedAt: string;
  notes: string;
  createdAt: string;
  status: 'PENDING' | 'CONTACTED' | 'DECLINED' | 'CANCELLED';
  signature: string;
}
const presentationKey = (id: string): string => 'mocmaria.presentation.' + id;
const inquiryKey = (id: string): string => 'mocmaria.inquiry.' + id;

@Injectable()
export class CustomerExperienceService {
  constructor(
    private readonly db: DataSource,
    private readonly chat: KtvChatService,
  ) {}
  private superAdmin(actor: AuthUserContext): void {
    if (!actor.roles.includes('SUPER_ADMIN'))
      throw new ForbiddenException('Chỉ super admin được duyệt mô tả công khai.');
  }
  private async read<T>(manager: EntityManager, key: string): Promise<T | undefined> {
    const [row] = await manager.query<{ value: T }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [key],
    );
    return row?.value;
  }
  private async save(manager: EntityManager, key: string, value: unknown): Promise<void> {
    await manager.query(
      `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
      [key, JSON.stringify(value)],
    );
  }
  private async lock(manager: EntityManager, key: string): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
  }
  private async application(
    actor: AuthUserContext,
  ): Promise<{ id: string; public_name: string; introduction: string | null }> {
    if (!actor.roles.some((r) => r === 'THERAPIST' || r === 'DOCTOR_CONSULTANT'))
      throw new ForbiddenException('Chỉ KTV được cập nhật mô tả.');
    const [app] = await this.db.query<
      { id: string; public_name: string; introduction: string | null }[]
    >('SELECT id,public_name,introduction FROM provider_applications WHERE user_id=$1', [actor.id]);
    if (!app) throw new NotFoundException('Bạn chưa có hồ sơ KTV.');
    return app;
  }
  async ownPresentation(actor: AuthUserContext): Promise<Presentation> {
    const app = await this.application(actor);
    return {
      providerId: app.id,
      publicName: app.public_name,
      introduction: app.introduction,
      ...(await this.read<Presentation>(this.db.manager, presentationKey(app.id))),
    };
  }
  async submitPresentation(
    actor: AuthUserContext,
    dto: SubmitPresentationDto,
  ): Promise<Presentation> {
    const app = await this.application(actor);
    const introduction = dto.introduction.trim();
    if (introduction.length < 30) throw new BadRequestException('Mô tả cần ít nhất 30 ký tự.');
    return this.db.transaction(async (m) => {
      await this.lock(m, presentationKey(app.id));
      const old = await this.read<Presentation>(m, presentationKey(app.id));
      const value: Presentation = {
        providerId: app.id,
        publicName: app.public_name,
        introduction: app.introduction,
        published: old?.published,
        revision: {
          id: randomUUID(),
          introduction,
          status: 'PENDING',
          submittedAt: new Date().toISOString(),
        },
      };
      await this.save(m, presentationKey(app.id), value);
      await m.save(AuditLog, {
        event: 'provider.presentation.submitted',
        actorUserId: actor.id,
        targetUserId: actor.id,
        metadata: { providerId: app.id, revisionId: value.revision!.id },
      });
      return value;
    });
  }
  async pendingPresentations(actor: AuthUserContext): Promise<Presentation[]> {
    this.superAdmin(actor);
    const rows = await this.db.query<{ value: Presentation }[]>(
      `SELECT value FROM app_metadata WHERE key LIKE 'mocmaria.presentation.%' AND value->'revision'->>'status'='PENDING' ORDER BY updated_at`,
    );
    return rows.map((r) => r.value);
  }
  async reviewPresentation(
    actor: AuthUserContext,
    id: string,
    dto: ReviewPresentationDto,
  ): Promise<Presentation> {
    this.superAdmin(actor);
    if (!dto.note.trim()) throw new BadRequestException('Cần ghi chú duyệt.');
    return this.db.transaction(async (m) => {
      await this.lock(m, presentationKey(id));
      const value = await this.read<Presentation>(m, presentationKey(id));
      if (!value?.revision) throw new NotFoundException('Không tìm thấy bản gửi duyệt.');
      if (value.revision.id !== dto.revisionId || value.revision.status !== 'PENDING')
        throw new ConflictException('Nội dung đã thay đổi. Hãy tải lại trước khi duyệt.');
      value.revision.status = dto.decision;
      value.revision.note = dto.note.trim();
      if (dto.decision === 'APPROVED')
        value.published = {
          introduction: value.revision.introduction,
          approvedAt: new Date().toISOString(),
        };
      await this.save(m, presentationKey(id), value);
      await m.save(AuditLog, {
        event: 'provider.presentation.reviewed',
        actorUserId: actor.id,
        metadata: { providerId: id, revisionId: dto.revisionId, decision: dto.decision },
      });
      return value;
    });
  }
  async publicPresentations(): Promise<Array<{ providerId: string; introduction: string }>> {
    const rows = await this.db.query<
      { value: Presentation }[]
    >(`SELECT m.value FROM app_metadata m JOIN provider_applications p ON p.id::text=m.value->>'providerId'
      JOIN users u ON u.id=p.user_id WHERE m.key LIKE 'mocmaria.presentation.%' AND m.value->'published'->>'introduction' IS NOT NULL
      AND u.is_active AND p.status NOT IN ('REJECTED','SUSPENDED')`);
    return rows.map(({ value }) => ({
      providerId: value.providerId,
      introduction: value.published!.introduction,
    }));
  }
  async createInquiry(
    actor: AuthUserContext,
    dto: CreateInquiryDto,
  ): Promise<Omit<Inquiry, 'signature' | 'providerUserId'>> {
    if (!actor.permissions.includes('customer.portal'))
      throw new ForbiddenException('Cần tài khoản khách hàng để gửi yêu cầu.');
    const requested = new Date(dto.requestedAt).getTime();
    if (
      !Number.isFinite(requested) ||
      requested < Date.now() ||
      requested > Date.now() + 60 * 86400000
    )
      throw new BadRequestException('Chọn thời gian trong 60 ngày tới.');
    if (dto.address.trim().length < 12)
      throw new BadRequestException('Vui lòng nhập địa chỉ đầy đủ.');
    const provider = (await this.chat.directory()).find((p) => p.id === dto.providerId);
    const service = provider?.services.find((s) => s.id === dto.serviceId);
    if (!provider || !service)
      throw new BadRequestException('KTV hoặc dịch vụ không còn nhận yêu cầu tư vấn.');
    const [receiver] = await this.db.query<{ user_id: string }[]>(
      'SELECT user_id FROM provider_applications WHERE id=$1',
      [provider.id],
    );
    if (!receiver) throw new NotFoundException('Không tìm thấy KTV.');
    if (receiver.user_id === actor.id)
      throw new BadRequestException('Không thể gửi yêu cầu cho chính mình.');
    const signature = createHash('sha256')
      .update(
        JSON.stringify({
          ...dto,
          idempotencyKey: undefined,
          address: dto.address.trim(),
          notes: dto.notes?.trim() || '',
        }),
      )
      .digest('hex');
    const id = createHash('sha256')
      .update(actor.id + dto.idempotencyKey)
      .digest('hex');
    return this.db.transaction(async (m) => {
      await this.lock(m, 'mocmaria.inquiry.customer.' + actor.id);
      const existing = await this.read<Inquiry>(m, inquiryKey(id));
      if (existing) {
        if (existing.signature !== signature)
          throw new ConflictException('Mã yêu cầu đã dùng cho nội dung khác.');
        return this.visibleInquiry(existing);
      }
      const [blocked] = await m.query<{ id: string }[]>(
        `SELECT t.id FROM ktv_chat_threads t JOIN ktv_chat_blocks b ON b.thread_id=t.id
        WHERE t.customer_user_id=$1 AND t.provider_user_id=$2 AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at>clock_timestamp()) LIMIT 1`,
        [actor.id, receiver.user_id],
      );
      if (blocked)
        throw new ForbiddenException(
          'Bạn và KTV đang chặn liên hệ. Hãy bỏ chặn trước khi gửi yêu cầu.',
        );
      const [count] = await m.query<{ count: string }[]>(
        `SELECT count(*)::text FROM app_metadata WHERE key LIKE 'mocmaria.inquiry.%' AND value->>'customerId'=$1 AND value->>'status'='PENDING'`,
        [actor.id],
      );
      if (Number(count.count) >= 20)
        throw new BadRequestException(
          'Bạn đang có nhiều yêu cầu chờ phản hồi. Hãy theo dõi hoặc hủy yêu cầu cũ.',
        );
      const [recent] = await m.query<{ count: string }[]>(
        `SELECT count(*)::text FROM app_metadata WHERE key LIKE 'mocmaria.inquiry.%' AND value->>'customerId'=$1 AND (value->>'createdAt')::timestamptz>clock_timestamp()-interval '1 hour'`,
        [actor.id],
      );
      if (Number(recent.count) >= 20)
        throw new BadRequestException(
          'Bạn đã gửi nhiều yêu cầu trong giờ này. Vui lòng thử lại sau.',
        );
      const value: Inquiry = {
        id,
        signature,
        customerId: actor.id,
        customerName: actor.displayName,
        providerId: provider.id,
        providerUserId: receiver.user_id,
        providerName: provider.publicName,
        serviceId: service.id,
        serviceName: service.name,
        region: 'Hà Nội',
        location: dto.location,
        address: dto.address.trim(),
        requestedAt: dto.requestedAt,
        notes: dto.notes?.trim() || '',
        createdAt: new Date().toISOString(),
        status: 'PENDING',
      };
      await this.save(m, inquiryKey(id), value);
      await m.save(AuditLog, {
        event: 'appointment.inquiry.created',
        actorUserId: actor.id,
        targetUserId: receiver.user_id,
        metadata: { inquiryId: id, providerId: provider.id },
      });
      return this.visibleInquiry(value);
    });
  }
  private visibleInquiry({
    signature: _signature,
    providerUserId: _providerUserId,
    ...value
  }: Inquiry): Omit<Inquiry, 'signature' | 'providerUserId'> {
    return value;
  }
  async inquiries(
    actor: AuthUserContext,
  ): Promise<Array<Omit<Inquiry, 'signature' | 'providerUserId'>>> {
    const technician = actor.roles.some((r) => r === 'THERAPIST' || r === 'DOCTOR_CONSULTANT');
    const rows = await this.db.query<{ value: Inquiry }[]>(
      `SELECT value FROM app_metadata WHERE key LIKE 'mocmaria.inquiry.%' AND (value->>'customerId'=$1 OR (value->>'providerUserId'=$1 AND $2::boolean)) ORDER BY updated_at DESC LIMIT 100`,
      [actor.id, technician],
    );
    return rows.map((r) => this.visibleInquiry(r.value));
  }
  async replyInquiry(
    actor: AuthUserContext,
    id: string,
    dto: ReplyInquiryDto,
  ): Promise<Omit<Inquiry, 'signature' | 'providerUserId'>> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new NotFoundException('Không tìm thấy yêu cầu.');
    return this.db.transaction(async (m) => {
      await this.lock(m, inquiryKey(id));
      const value = await this.read<Inquiry>(m, inquiryKey(id));
      if (!value || (value.customerId !== actor.id && value.providerUserId !== actor.id))
        throw new NotFoundException('Không tìm thấy yêu cầu.');
      if (
        dto.status === 'CANCELLED'
          ? value.customerId !== actor.id
          : value.providerUserId !== actor.id
      )
        throw new ForbiddenException('Bạn không có quyền thực hiện thao tác này.');
      if (
        dto.status !== 'CANCELLED' &&
        !actor.roles.some((r) => r === 'THERAPIST' || r === 'DOCTOR_CONSULTANT')
      )
        throw new ForbiddenException('Cần tài khoản KTV để phản hồi.');
      if (
        value.status !== 'PENDING' &&
        !(value.status === 'CONTACTED' && dto.status === 'CANCELLED')
      )
        throw new ConflictException('Yêu cầu đã được xử lý.');
      value.status = dto.status;
      await this.save(m, inquiryKey(id), value);
      await m.save(AuditLog, {
        event: 'appointment.inquiry.updated',
        actorUserId: actor.id,
        metadata: { inquiryId: id, status: dto.status },
      });
      return this.visibleInquiry(value);
    });
  }
}
