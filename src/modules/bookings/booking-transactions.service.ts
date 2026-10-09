import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { User } from '../identity/entities/user.entity';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { ProviderApplication } from '../providers/entities/provider-application.entity';
import { ProviderBranchAssignment } from '../providers/entities/provider-branch-assignment.entity';
import { ServiceProviderPolicy } from '../providers/entities/service-provider-policy.entity';
import { TrainingCourse } from '../providers/entities/training-course.entity';
import { Branch } from '../catalog/entities/branch.entity';
import { ServiceVariant } from '../catalog/entities/service-variant.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { BranchService } from '../catalog/entities/branch-service.entity';
import { BranchResource } from '../catalog/entities/branch-resource.entity';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { BookingVariantSetting } from './entities/booking-variant-setting.entity';
import { AvailabilityService, AvailabilityContext, PlannedSlot } from './availability.service';
import { localDate, MINUTE_MS } from './availability-rules';
import { Appointment, AppointmentStatus } from './entities/appointment.entity';
import {
  AppointmentItem,
  AppointmentQuote,
  AppointmentResource,
  AppointmentStaff,
  AppointmentStatusHistory,
} from './entities/appointment-details.entity';
import {
  CreateBookingRequestDto,
  ConfirmBookingQuoteDto,
  ProviderBookingDecisionDto,
  ReviseBookingQuoteDto,
} from './dto/booking-request.dto';

const HOLD_STATES: AppointmentStatus[] = ['REQUESTED', 'ACCEPTED', 'CUSTOMER_CONFIRMED'];
type BookingView = Record<string, unknown>;

@Injectable()
export class BookingTransactionsService {
  constructor(
    private readonly database: DataSource,
    private readonly availability: AvailabilityService,
  ) {}

  // SSI prevents predicate/write skew; canonical application/course/branch locks serialize reservations.
  // A changed snapshot or deadlock reruns all eligibility and capacity checks on a fresh transaction.
  private async transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.transaction('SERIALIZABLE', work);
      } catch (error) {
        const code =
          typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
        const constraint =
          typeof error === 'object' && error && 'constraint' in error
            ? String(error.constraint)
            : '';
        if (
          !['40001', '40P01'].includes(code) &&
          !(code === '23505' && constraint === 'appointments_customer_user_id_idempotency_key_key')
        )
          throw error;
        if (attempt === 2)
          throw new ConflictException('Lịch vừa thay đổi. Vui lòng tải lại và thử lại.');
      }
    }
    throw new ConflictException('Không thể giữ chỗ lúc này.');
  }

  private async lockScope(
    manager: EntityManager,
    branchId: string,
    providerId?: string,
  ): Promise<void> {
    const assignments = await manager.find(ProviderBranchAssignment, {
      where: {
        branchId,
        ...(providerId ? { providerApplicationId: providerId } : { isActive: true }),
      },
      order: { providerApplicationId: 'ASC' },
      take: 200,
    });
    const ids = providerId ? [providerId] : assignments.map((a) => a.providerApplicationId);
    const applications = ids.length
      ? await manager.find(ProviderApplication, {
          where: { id: In(ids) },
          order: { id: 'ASC' },
          lock: { mode: 'pessimistic_write' },
        })
      : [];
    const policies = await manager.find(ServiceProviderPolicy, {
      where: { branchId, mode: 'ON_SITE' },
    });
    const courseIds = Array.from(new Set(policies.map((p) => p.courseId))).sort();
    if (courseIds.length)
      await manager.find(TrainingCourse, {
        where: { id: In(courseIds) },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_read' },
      });
    if (
      !(await manager.findOne(Branch, {
        where: { id: branchId },
        lock: { mode: 'pessimistic_write' },
      }))
    )
      throw new NotFoundException('Không tìm thấy cơ sở.');
    const userIds = applications.map((a) => a.userId).sort();
    if (userIds.length) {
      await manager.find(User, {
        where: { id: In(userIds) },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_read' },
      });
      await manager.find(StaffProfile, {
        where: { userId: In(userIds) },
        order: { userId: 'ASC' },
        lock: { mode: 'pessimistic_read' },
      });
    }
    await manager.find(ServiceProviderPolicy, {
      where: { branchId, mode: 'ON_SITE' },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_read' },
    });
    await manager.find(BranchResource, {
      where: { branchId },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_read' },
    });
  }
  private async lockCatalog(
    manager: EntityManager,
    branchId: string,
    variantId: string,
  ): Promise<void> {
    const variant = await manager.findOne(ServiceVariant, {
      where: { id: variantId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!variant) throw new NotFoundException('Không tìm thấy gói dịch vụ.');
    const service = await manager.findOne(Service, {
      where: { id: variant.serviceId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!service) throw new NotFoundException('Không tìm thấy dịch vụ.');
    await manager.findOne(ServiceCategory, {
      where: { id: service.categoryId },
      lock: { mode: 'pessimistic_read' },
    });
    await manager.findOne(BranchService, {
      where: { branchId, serviceId: service.id },
      lock: { mode: 'pessimistic_read' },
    });
    await manager.findOne(BookingVariantSetting, {
      where: { branchId, variantId, mode: 'AT_BRANCH' },
      lock: { mode: 'pessimistic_read' },
    });
  }
  private async activeActor(manager: EntityManager, id: string): Promise<void> {
    const user = await manager.findOne(User, { where: { id }, lock: { mode: 'pessimistic_read' } });
    if (!user?.isActive || user.mustChangePassword)
      throw new BadRequestException('Tài khoản chưa sẵn sàng gửi hoặc xác nhận yêu cầu.');
  }
  private async history(
    manager: EntityManager,
    appointment: Appointment,
    actorId: string,
    previous: AppointmentStatus | null,
    reason: string,
  ): Promise<void> {
    await manager.save(AppointmentStatusHistory, {
      appointmentId: appointment.id,
      previousStatus: previous,
      nextStatus: appointment.status,
      actorUserId: actorId,
      reason,
      metadata: { version: appointment.version, quoteRevision: appointment.currentQuoteRevision },
    });
    await manager.save(AuditLog, {
      actorUserId: actorId,
      targetUserId: appointment.customerUserId,
      event: 'booking.' + appointment.status.toLowerCase(),
      metadata: {
        appointmentId: appointment.id,
        previousStatus: previous,
        version: appointment.version,
        quoteRevision: appointment.currentQuoteRevision,
        reason,
      },
    });
  }
  private async transition(
    manager: EntityManager,
    appointment: Appointment,
    actorId: string,
    status: AppointmentStatus,
    reason: string,
  ): Promise<void> {
    const previous = appointment.status;
    appointment.status = status;
    appointment.version++;
    await manager.save(Appointment, appointment);
    await this.history(manager, appointment, actorId, previous, reason);
  }
  private async expire(
    manager: EntityManager,
    appointment: Appointment,
    actorId: string,
  ): Promise<boolean> {
    if (HOLD_STATES.includes(appointment.status) && appointment.requestExpiresAt <= new Date()) {
      await this.transition(
        manager,
        appointment,
        actorId,
        'EXPIRED',
        'Thời hạn giữ yêu cầu đã kết thúc.',
      );
      return true;
    }
    return appointment.status === 'EXPIRED';
  }
  private async quote(
    manager: EntityManager,
    appointment: Appointment,
    actorId: string,
    context: AvailabilityContext,
    slot: PlannedSlot,
    reason: string,
    extraFeeVnd = '0',
    discountVnd = '0',
  ): Promise<AppointmentQuote> {
    const total = BigInt(slot.priceVnd) + BigInt(extraFeeVnd) - BigInt(discountVnd);
    if (total < 0n) throw new BadRequestException('Giảm giá không thể vượt tổng báo giá.');
    return manager.save(AppointmentQuote, {
      appointmentId: appointment.id,
      revision: appointment.currentQuoteRevision,
      servicePriceVnd: slot.priceVnd,
      travelFeeVnd: '0',
      extraFeeVnd,
      discountVnd,
      totalVnd: total.toString(),
      snapshot: {
        mode: 'AT_BRANCH',
        branchId: context.branch.id,
        branchName: context.branch.name,
        serviceId: context.service.id,
        serviceName: context.service.name,
        variantId: context.variant.id,
        variantName: context.variant.name,
        durationMinutes: context.variant.durationMinutes,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        providerApplicationId: slot.providerApplicationId,
        providerName: slot.providerName,
      },
      reason,
      createdBy: actorId,
      acceptedBy: null,
      acceptedAt: null,
    });
  }
  private async allocate(
    manager: EntityManager,
    appointment: Appointment,
    slot: PlannedSlot,
  ): Promise<void> {
    await manager.delete(AppointmentResource, { appointmentId: appointment.id });
    for (const allocation of slot.resourceAllocation)
      await manager.save(AppointmentResource, { appointmentId: appointment.id, ...allocation });
    appointment.blockedStartsAt = new Date(slot.blockedStartsAt);
    appointment.blockedEndsAt = new Date(slot.blockedEndsAt);
  }
  async create(customerId: string, dto: CreateBookingRequestDto): Promise<BookingView> {
    const startsAt = new Date(dto.startsAt);
    if (!Number.isFinite(startsAt.getTime()))
      throw new BadRequestException('Thời gian không hợp lệ.');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          branchId: dto.branchId,
          variantId: dto.variantId,
          startsAt: startsAt.toISOString(),
          providerApplicationId: dto.providerApplicationId ?? null,
          expectedTotalVnd: dto.expectedTotalVnd,
          quoteAcknowledged: dto.quoteAcknowledged,
          notes: dto.notes?.trim() || null,
        }),
      )
      .digest('hex');
    return this.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'booking-request:' + customerId + ':' + dto.idempotencyKey,
      ]);
      const existing = await manager.findOneBy(Appointment, {
        customerUserId: customerId,
        idempotencyKey: dto.idempotencyKey,
      });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint)
          throw new ConflictException('Mã yêu cầu đã được dùng với nội dung khác.');
        return this.view(manager, existing, 'CUSTOMER');
      }
      await this.lockScope(manager, dto.branchId, dto.providerApplicationId);
      await this.activeActor(manager, customerId);
      await this.lockCatalog(manager, dto.branchId, dto.variantId);
      const planned = await this.availability.plan(
        {
          branchId: dto.branchId,
          variantId: dto.variantId,
          date: localDate(startsAt),
          providerApplicationId: dto.providerApplicationId,
        },
        manager,
        new Date(),
        200,
        { startsAt: startsAt.toISOString() },
      );
      if (!planned.context || !planned.slots.length)
        throw new ConflictException('Khung giờ không còn khả dụng hoặc KTV chưa đủ điều kiện.');
      let chosen: PlannedSlot | undefined;
      for (const slot of planned.slots) {
        const provider = await manager.findOneByOrFail(ProviderApplication, {
          id: slot.providerApplicationId,
        });
        if (provider.userId !== customerId) {
          chosen = slot;
          break;
        }
      }
      if (!chosen) throw new BadRequestException('Không thể đặt lịch do chính mình phục vụ.');
      if (!dto.quoteAcknowledged || chosen.totalVnd !== dto.expectedTotalVnd)
        throw new ConflictException('Giá đã thay đổi. Vui lòng xem và đồng ý báo giá hiện tại.');
      const { context } = planned;
      const appointment = await manager.save(Appointment, {
        customerUserId: customerId,
        createdBy: customerId,
        branchId: dto.branchId,
        mode: 'AT_BRANCH',
        status: 'REQUESTED',
        startsAt,
        endsAt: new Date(chosen.endsAt),
        blockedStartsAt: new Date(chosen.blockedStartsAt),
        blockedEndsAt: new Date(chosen.blockedEndsAt),
        requestExpiresAt: new Date(
          Math.min(startsAt.getTime(), Date.now() + context.setting.requestTtlMinutes * MINUTE_MS),
        ),
        currentQuoteRevision: 1,
        idempotencyKey: dto.idempotencyKey,
        requestFingerprint: fingerprint,
        version: 1,
        source: 'WEB',
        notes: dto.notes?.trim() || null,
        destination: null,
      });
      await manager.save(AppointmentItem, {
        appointmentId: appointment.id,
        serviceId: context.service.id,
        variantId: context.variant.id,
        serviceName: context.service.name,
        variantName: context.variant.name,
        durationMinutes: context.variant.durationMinutes,
        bufferBeforeMinutes: context.variant.bufferBeforeMinutes,
        bufferAfterMinutes: context.variant.bufferAfterMinutes,
        priceVnd: chosen.priceVnd,
      });
      await manager.save(AppointmentStaff, {
        appointmentId: appointment.id,
        providerApplicationId: chosen.providerApplicationId,
      });
      await this.allocate(manager, appointment, chosen);
      await this.quote(
        manager,
        appointment,
        customerId,
        context,
        chosen,
        'Khách đồng ý giá khi gửi yêu cầu.',
      );
      await this.history(
        manager,
        appointment,
        customerId,
        null,
        'Khách gửi yêu cầu đặt lịch tại cơ sở.',
      );
      return this.view(manager, appointment, 'CUSTOMER');
    });
  }
  private async lockedAppointment(
    manager: EntityManager,
    id: string,
    actorId: string,
    role: 'CUSTOMER' | 'PROVIDER' | 'ADMIN',
  ): Promise<Appointment> {
    const current = await manager.findOneBy(Appointment, { id });
    if (!current) throw new NotFoundException('Không tìm thấy lịch hẹn.');
    const assignment = await manager.findOneByOrFail(AppointmentStaff, { appointmentId: id });
    const provider = await manager.findOneByOrFail(ProviderApplication, {
      id: assignment.providerApplicationId,
    });
    if (
      (role === 'CUSTOMER' && current.customerUserId !== actorId) ||
      (role === 'PROVIDER' && provider.userId !== actorId)
    )
      throw new NotFoundException('Không tìm thấy lịch hẹn.');
    await this.lockScope(manager, current.branchId, provider.id);
    await this.activeActor(manager, actorId);
    return manager.findOneOrFail(Appointment, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }
  private async revalidate(
    manager: EntityManager,
    appointment: Appointment,
  ): Promise<{ context: AvailabilityContext; slot: PlannedSlot; quote: AppointmentQuote }> {
    if (appointment.mode !== 'AT_BRANCH')
      throw new BadRequestException('Hình thức tại nhà đang được hoàn thiện.');
    const item = await manager.findOneByOrFail(AppointmentItem, { appointmentId: appointment.id });
    const staff = await manager.findOneByOrFail(AppointmentStaff, {
      appointmentId: appointment.id,
    });
    await this.lockCatalog(manager, appointment.branchId, item.variantId);
    const planned = await this.availability.plan(
      {
        branchId: appointment.branchId,
        variantId: item.variantId,
        date: localDate(appointment.startsAt),
        providerApplicationId: staff.providerApplicationId,
      },
      manager,
      new Date(),
      1,
      { startsAt: appointment.startsAt.toISOString(), excludeAppointmentId: appointment.id },
    );
    const slot = planned.slots[0];
    if (!planned.context || !slot || slot.endsAt !== appointment.endsAt.toISOString())
      throw new ConflictException(
        'Lịch hoặc điều kiện phục vụ đã thay đổi. Cần kiểm tra và gửi yêu cầu mới.',
      );
    const quote = await manager.findOneByOrFail(AppointmentQuote, {
      appointmentId: appointment.id,
      revision: appointment.currentQuoteRevision,
    });
    await this.allocate(manager, appointment, slot);
    return { context: planned.context, slot, quote };
  }
  private async refreshPrice(
    manager: EntityManager,
    appointment: Appointment,
    actorId: string,
    planned: { context: AvailabilityContext; slot: PlannedSlot; quote: AppointmentQuote },
  ): Promise<boolean> {
    if (planned.quote.servicePriceVnd === planned.slot.priceVnd) return false;
    appointment.currentQuoteRevision++;
    appointment.version++;
    await this.quote(
      manager,
      appointment,
      actorId,
      planned.context,
      planned.slot,
      'Giá niêm yết thay đổi; cần khách đồng ý lại.',
      planned.quote.extraFeeVnd,
      planned.quote.discountVnd,
    );
    await manager.save(Appointment, appointment);
    await this.history(
      manager,
      appointment,
      actorId,
      appointment.status,
      'Báo giá mới sau thay đổi giá niêm yết.',
    );
    return true;
  }
  async decide(
    providerUserId: string,
    id: string,
    dto: ProviderBookingDecisionDto,
  ): Promise<BookingView> {
    if (dto.reason.trim().length < 3) throw new BadRequestException('Cần lý do rõ ràng.');
    return this.transaction(async (manager) => {
      const appointment = await this.lockedAppointment(manager, id, providerUserId, 'PROVIDER');
      if (await this.expire(manager, appointment, providerUserId))
        return this.view(manager, appointment, 'PROVIDER');
      if (appointment.version !== dto.expectedVersion || appointment.status !== 'REQUESTED')
        throw new ConflictException('Yêu cầu đã thay đổi hoặc không còn chờ KTV.');
      if (dto.decision === 'DECLINE')
        await this.transition(manager, appointment, providerUserId, 'DECLINED', dto.reason.trim());
      else {
        const planned = await this.revalidate(manager, appointment);
        await this.refreshPrice(manager, appointment, providerUserId, planned);
        await this.transition(manager, appointment, providerUserId, 'ACCEPTED', dto.reason.trim());
      }
      return this.view(manager, appointment, 'PROVIDER');
    });
  }
  async confirm(customerId: string, id: string, dto: ConfirmBookingQuoteDto): Promise<BookingView> {
    return this.transaction(async (manager) => {
      const appointment = await this.lockedAppointment(manager, id, customerId, 'CUSTOMER');
      if (await this.expire(manager, appointment, customerId))
        return this.view(manager, appointment, 'CUSTOMER');
      const quote = await manager.findOneByOrFail(AppointmentQuote, {
        appointmentId: id,
        revision: appointment.currentQuoteRevision,
      });
      if (
        !dto.accepted ||
        quote.revision !== dto.quoteRevision ||
        quote.totalVnd !== dto.expectedTotalVnd
      )
        throw new ConflictException('Báo giá đã thay đổi. Vui lòng xem và xác nhận phiên bản mới.');
      if (appointment.status === 'CONFIRMED' && quote.acceptedBy === customerId)
        return this.view(manager, appointment, 'CUSTOMER');
      if (appointment.status !== 'ACCEPTED')
        throw new ConflictException('Cần KTV nhận yêu cầu trước khi xác nhận báo giá.');
      const planned = await this.revalidate(manager, appointment);
      if (await this.refreshPrice(manager, appointment, customerId, planned))
        return this.view(manager, appointment, 'CUSTOMER');
      quote.acceptedBy = customerId;
      quote.acceptedAt = new Date();
      await manager.save(AppointmentQuote, quote);
      await this.transition(
        manager,
        appointment,
        customerId,
        'CUSTOMER_CONFIRMED',
        'Khách đồng ý phiên bản báo giá ' + quote.revision + '.',
      );
      await this.transition(
        manager,
        appointment,
        customerId,
        'CONFIRMED',
        'Lịch được xác nhận sau khi KTV nhận và khách đồng ý báo giá.',
      );
      return this.view(manager, appointment, 'CUSTOMER');
    });
  }
  async revise(actorId: string, id: string, dto: ReviseBookingQuoteDto): Promise<BookingView> {
    if (dto.reason.trim().length < 3) throw new BadRequestException('Cần lý do rõ ràng.');
    return this.transaction(async (manager) => {
      const appointment = await this.lockedAppointment(manager, id, actorId, 'ADMIN');
      if (await this.expire(manager, appointment, actorId))
        return this.view(manager, appointment, 'ADMIN');
      if (
        appointment.version !== dto.expectedVersion ||
        !['REQUESTED', 'ACCEPTED'].includes(appointment.status)
      )
        throw new ConflictException('Chỉ sửa báo giá đang chờ xác nhận, đúng phiên bản.');
      const planned = await this.revalidate(manager, appointment);
      appointment.currentQuoteRevision++;
      appointment.version++;
      await this.quote(
        manager,
        appointment,
        actorId,
        planned.context,
        planned.slot,
        dto.reason.trim(),
        dto.extraFeeVnd,
        dto.discountVnd,
      );
      await manager.save(Appointment, appointment);
      await this.history(manager, appointment, actorId, appointment.status, dto.reason.trim());
      return this.view(manager, appointment, 'ADMIN');
    });
  }
  private async view(
    manager: EntityManager,
    appointment: Appointment,
    role: 'CUSTOMER' | 'PROVIDER' | 'ADMIN',
  ): Promise<BookingView> {
    const quote = await manager.findOneByOrFail(AppointmentQuote, {
      appointmentId: appointment.id,
      revision: appointment.currentQuoteRevision,
    });
    const history = await manager.find(AppointmentStatusHistory, {
      where: { appointmentId: appointment.id },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const expired =
      HOLD_STATES.includes(appointment.status) && appointment.requestExpiresAt <= new Date();
    return {
      id: appointment.id,
      status: expired ? 'EXPIRED' : appointment.status,
      version: appointment.version,
      mode: appointment.mode,
      startsAt: appointment.startsAt.toISOString(),
      endsAt: appointment.endsAt.toISOString(),
      requestExpiresAt: appointment.requestExpiresAt.toISOString(),
      notes: role === 'CUSTOMER' || appointment.status === 'CONFIRMED' ? appointment.notes : null,
      quote: {
        revision: quote.revision,
        servicePriceVnd: quote.servicePriceVnd,
        travelFeeVnd: quote.travelFeeVnd,
        extraFeeVnd: quote.extraFeeVnd,
        discountVnd: quote.discountVnd,
        totalVnd: quote.totalVnd,
        snapshot: quote.snapshot,
        reason: quote.reason,
        acceptedAt: quote.acceptedAt?.toISOString() ?? null,
      },
      history: history
        .sort(
          (a, b) =>
            Number(a.metadata['version'] ?? 0) - Number(b.metadata['version'] ?? 0) ||
            a.createdAt.getTime() - b.createdAt.getTime(),
        )
        .map((h) => ({
          previousStatus: h.previousStatus,
          nextStatus: h.nextStatus,
          reason: h.reason,
          createdAt: h.createdAt.toISOString(),
        })),
    };
  }
  async list(actorId: string, role: 'CUSTOMER' | 'PROVIDER' | 'ADMIN'): Promise<BookingView[]> {
    return this.database.transaction('REPEATABLE READ', async (manager) => {
      let ids: string[] | undefined;
      if (role === 'PROVIDER') {
        const provider = await manager.findOneBy(ProviderApplication, { userId: actorId });
        if (!provider) return [];
        ids = (
          await manager.find(AppointmentStaff, { where: { providerApplicationId: provider.id } })
        ).map((s) => s.appointmentId);
        if (!ids.length) return [];
      }
      const appointments = await manager.find(Appointment, {
        where: role === 'CUSTOMER' ? { customerUserId: actorId } : ids ? { id: In(ids) } : {},
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 100,
      });
      const views: BookingView[] = [];
      for (const appointment of appointments)
        views.push(await this.view(manager, appointment, role));
      return views;
    });
  }
}
