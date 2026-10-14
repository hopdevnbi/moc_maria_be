import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { AuditLog } from '../identity/entities/audit-log.entity';
interface ReportableInquiry {
  id: string;
  providerUserId: string;
  customerId: string;
  status: string;
  requestedAt: string;
  appointmentId?: string;
  archivedAt?: string;
  providerCompletedAt?: string;
}
@Injectable()
export class ProviderWorkspaceService {
  constructor(private readonly db: DataSource) {}
  async complete(
    actor: AuthUserContext,
    id: string,
    dto: { servicePerformedConfirmed: boolean; reason: string },
  ): Promise<{ inquiryId: string; providerCompletedAt: string }> {
    if (!actor.roles.some((r) => r === 'THERAPIST' || r === 'DOCTOR_CONSULTANT'))
      throw new ForbiddenException('Chỉ KTV được báo hoàn thành.');
    if (!/^[a-f0-9]{64}$/.test(id)) throw new NotFoundException('Không tìm thấy yêu cầu.');
    if (!dto.servicePerformedConfirmed || dto.reason.trim().length < 10 || dto.reason.length > 500)
      throw new BadRequestException('Hãy xác nhận buổi chăm sóc đã thực sự hoàn thành.');
    return this.db.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'mocmaria.inquiry.' + id,
      ]);
      const [row] = await m.query<{ value: ReportableInquiry }[]>(
        'SELECT value FROM app_metadata WHERE key=$1 FOR UPDATE',
        ['mocmaria.inquiry.' + id],
      );
      const inquiry = row?.value;
      if (!inquiry || inquiry.id !== id || inquiry.providerUserId !== actor.id)
        throw new NotFoundException('Không tìm thấy yêu cầu của bạn.');
      if (inquiry.appointmentId)
        throw new ConflictException('Lịch đã xác nhận cần cập nhật trong tiến độ phục vụ.');
      if (inquiry.archivedAt || inquiry.status !== 'CONTACTED')
        throw new ConflictException('Chỉ yêu cầu đã nhận trao đổi mới được báo hoàn thành.');
      const requestedAt = new Date(inquiry.requestedAt).getTime();
      if (!Number.isFinite(requestedAt) || requestedAt > Date.now())
        throw new BadRequestException('Chưa đến thời gian phục vụ đã đề nghị.');
      if (inquiry.providerCompletedAt)
        return { inquiryId: id, providerCompletedAt: inquiry.providerCompletedAt };
      inquiry.providerCompletedAt = new Date().toISOString();
      await m.query(
        'UPDATE app_metadata SET value=$2::jsonb,updated_at=clock_timestamp() WHERE key=$1',
        ['mocmaria.inquiry.' + id, JSON.stringify(inquiry)],
      );
      await m.save(AuditLog, {
        event: 'appointment.inquiry.provider_completed',
        actorUserId: actor.id,
        targetUserId: inquiry.customerId,
        metadata: { inquiryId: id, reason: dto.reason.trim(), servicePerformedConfirmed: true },
      });
      // This report does not create a verified appointment, certificate, or review entitlement.
      return { inquiryId: id, providerCompletedAt: inquiry.providerCompletedAt };
    });
  }
}
