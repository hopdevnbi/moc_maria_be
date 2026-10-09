import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Branch } from '../catalog/entities/branch.entity';
import { BranchResource } from '../catalog/entities/branch-resource.entity';
import { BranchService } from '../catalog/entities/branch-service.entity';
import { ServiceVariant } from '../catalog/entities/service-variant.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { ProviderApplication } from '../providers/entities/provider-application.entity';
import { ProviderBranchAssignment } from '../providers/entities/provider-branch-assignment.entity';
import { ProviderEligibilityService } from '../providers/provider-eligibility.service';
import { ProviderScheduleService } from '../providers/provider-schedule.service';
import { ProviderTrustService } from '../providers/provider-trust.service';
import { User } from '../identity/entities/user.entity';
import { BookingVariantSetting } from './entities/booking-variant-setting.entity';
import { AvailabilityQueryDto } from './dto/availability.dto';
import {
  allocateResources,
  BUSINESS_TIMEZONE,
  instant,
  localDate,
  MINUTE_MS,
  plusDays,
} from './availability-rules';
import type { Occupancy } from './availability-rules';
import { validCalendarDate } from '../providers/provider-schedule-rules';

export const OCCUPYING_APPOINTMENT_SQL =
  "(a.status IN ('CONFIRMED','CHECKED_IN','IN_SERVICE','COMPLETED') OR (a.status IN ('REQUESTED','ACCEPTED','CUSTOMER_CONFIRMED') AND a.request_expires_at>$3))";
interface BusyRow {
  owner_id: string;
  blocked_starts_at: Date;
  blocked_ends_at: Date;
  units: number;
}
export interface PlannedSlot {
  startsAt: string;
  endsAt: string;
  blockedStartsAt: string;
  blockedEndsAt: string;
  providerApplicationId: string;
  providerName: string;
  policyId: string;
  priceVnd: string;
  travelFeeVnd: string;
  totalVnd: string;
  resourceAllocation: Array<{ resourceId: string; units: number }>;
}
export interface AvailabilityResult {
  timezone: typeof BUSINESS_TIMEZONE;
  date: string;
  mode: 'AT_BRANCH';
  reservation: false;
  requestEnabled: true;
  search?: { fromDate: string; throughDate: string; hasMoreDates: boolean };
  blockers: string[];
  slots: Array<
    Omit<PlannedSlot, 'blockedStartsAt' | 'blockedEndsAt' | 'policyId' | 'resourceAllocation'>
  >;
}
export interface AvailabilityContext {
  branch: Branch;
  service: Service;
  variant: ServiceVariant;
  mapping: BranchService;
  setting: BookingVariantSetting;
}
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly database: DataSource,
    private readonly eligibility: ProviderEligibilityService,
    private readonly schedules: ProviderScheduleService,
    private readonly trust: ProviderTrustService,
  ) {}
  async context(
    query: AvailabilityQueryDto,
    manager: EntityManager,
  ): Promise<AvailabilityContext | null> {
    const branch = await manager.findOneBy(Branch, { id: query.branchId, isActive: true });
    const variant = await manager.findOneBy(ServiceVariant, {
      id: query.variantId,
      isActive: true,
    });
    const service = variant
      ? await manager.findOneBy(Service, { id: variant.serviceId, isPublished: true })
      : null;
    if (
      !branch ||
      !variant ||
      !service ||
      !(await manager.findOneBy(ServiceCategory, { id: service.categoryId, isPublished: true }))
    )
      throw new NotFoundException('Không tìm thấy gói dịch vụ công khai tại cơ sở.');
    const mapping = await manager.findOneBy(BranchService, {
      branchId: branch.id,
      serviceId: service.id,
      isActive: true,
    });
    if (!mapping) throw new NotFoundException('Gói dịch vụ chưa phục vụ tại cơ sở.');
    const setting = await manager.findOneBy(BookingVariantSetting, {
      variantId: variant.id,
      branchId: branch.id,
      mode: 'AT_BRANCH',
      isEnabled: true,
    });
    return setting ? { branch, service, variant, mapping, setting } : null;
  }
  async plan(
    query: AvailabilityQueryDto,
    manager: EntityManager,
    at = new Date(),
    limit = 120,
    selection: { startsAt?: string; excludeAppointmentId?: string } = {},
  ): Promise<{ context: AvailabilityContext | null; slots: PlannedSlot[]; blockers: string[] }> {
    if (!validCalendarDate(query.date)) throw new BadRequestException('Ngày không hợp lệ.');
    const context = await this.context(query, manager);
    if (!context) return { context, slots: [], blockers: ['BOOKING_CONFIGURATION_PENDING'] };
    const { branch, service, variant, mapping, setting } = context;
    const today = localDate(at);
    if (query.date < today || query.date > plusDays(today, setting.horizonDays))
      return { context, slots: [], blockers: ['DATE_OUTSIDE_BOOKING_WINDOW'] };
    const assignments = await manager.find(ProviderBranchAssignment, {
      where: {
        branchId: branch.id,
        isActive: true,
        ...(query.providerApplicationId
          ? { providerApplicationId: query.providerApplicationId }
          : {}),
      },
      order: { providerApplicationId: 'ASC' },
      take: 200,
    });
    const applications = assignments.length
      ? await manager.find(ProviderApplication, {
          where: { id: In(assignments.map((a) => a.providerApplicationId)), status: 'APPROVED' },
          order: { id: 'ASC' },
        })
      : [];
    const users = applications.length
      ? await manager.find(User, {
          where: { id: In(applications.map((a) => a.userId)), isActive: true },
        })
      : [];
    const trusted = await this.trust.publicEligibleIds(applications, users, manager);
    const readiness = await this.eligibility.readinessBatch(
      applications.map((a) => a.id),
      manager,
      at,
    );
    const providers = applications.flatMap((app) => {
      const policy = readiness
        .get(app.id)
        ?.services.filter(
          (s) => s.serviceId === service.id && s.branchId === branch.id && s.mode === 'ON_SITE',
        )
        .sort(
          (a, b) =>
            b.validThrough.getTime() - a.validThrough.getTime() ||
            a.policyId.localeCompare(b.policyId),
        )[0];
      return trusted.has(app.id) && policy ? [{ app, policy }] : [];
    });
    if (!providers.length) return { context, slots: [], blockers: ['NO_ELIGIBLE_PROVIDER'] };
    const dayStart = instant(query.date, 0),
      dayEnd = instant(query.date, 1440);
    const providerBusy = await manager.query<BusyRow[]>(
      `SELECT s.provider_application_id AS owner_id,a.blocked_starts_at,a.blocked_ends_at,1::integer AS units
   FROM appointment_staff s JOIN appointments a ON a.id=s.appointment_id
   WHERE a.blocked_starts_at<$2 AND a.blocked_ends_at>$1 AND ${OCCUPYING_APPOINTMENT_SQL}
   AND s.provider_application_id=ANY($4::uuid[]) AND ($5::uuid IS NULL OR a.id<>$5)`,
      [
        dayStart,
        dayEnd,
        at,
        providers.map((p) => p.app.id),
        selection.excludeAppointmentId ?? null,
      ],
    );
    const resources = await manager.find(BranchResource, {
      where: { branchId: branch.id, isActive: true },
      order: { id: 'ASC' },
    });
    const resourceRows = resources.length
      ? await manager.query<BusyRow[]>(
          `SELECT r.resource_id AS owner_id,a.blocked_starts_at,a.blocked_ends_at,r.units
   FROM appointment_resources r JOIN appointments a ON a.id=r.appointment_id
   WHERE a.blocked_starts_at<$2 AND a.blocked_ends_at>$1 AND ${OCCUPYING_APPOINTMENT_SQL}
   AND r.resource_id=ANY($4::uuid[]) AND ($5::uuid IS NULL OR a.id<>$5)`,
          [
            dayStart,
            dayEnd,
            at,
            resources.map((r) => r.id),
            selection.excludeAppointmentId ?? null,
          ],
        )
      : [];
    const resourceBusy = new Map<string, Occupancy[]>();
    for (const row of resourceRows)
      resourceBusy.set(row.owner_id, [
        ...(resourceBusy.get(row.owner_id) || []),
        { startsAt: row.blocked_starts_at, endsAt: row.blocked_ends_at, units: row.units },
      ]);
    const price = mapping.priceOverrideVnd ?? variant.priceVnd;
    const slots: PlannedSlot[] = [];
    for (const { app, policy } of providers) {
      const planning = await this.schedules.windows(app.id, branch.id, query.date, manager);
      for (const window of planning.windows) {
        const first =
          Math.ceil(
            (window.startsAtMinute + variant.bufferBeforeMinutes) / setting.slotStepMinutes,
          ) * setting.slotStepMinutes;
        for (
          let minute = first;
          minute + variant.durationMinutes + variant.bufferAfterMinutes <= window.endsAtMinute;
          minute += setting.slotStepMinutes
        ) {
          const start = instant(query.date, minute),
            end = new Date(start.getTime() + variant.durationMinutes * MINUTE_MS);
          if (selection.startsAt && start.toISOString() !== selection.startsAt) continue;
          const blockedStart = new Date(start.getTime() - variant.bufferBeforeMinutes * MINUTE_MS),
            blockedEnd = new Date(end.getTime() + variant.bufferAfterMinutes * MINUTE_MS);
          if (
            start.getTime() < at.getTime() + setting.leadMinutes * MINUTE_MS ||
            policy.validThrough < blockedEnd ||
            providerBusy.some(
              (b) =>
                b.owner_id === app.id &&
                b.blocked_starts_at < blockedEnd &&
                b.blocked_ends_at > blockedStart,
            )
          )
            continue;
          const allocation = allocateResources(
            setting.resourceRequirements,
            resources,
            resourceBusy,
            blockedStart,
            blockedEnd,
          );
          if (!allocation) continue;
          slots.push({
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            blockedStartsAt: blockedStart.toISOString(),
            blockedEndsAt: blockedEnd.toISOString(),
            providerApplicationId: app.id,
            providerName: app.publicName,
            policyId: policy.policyId,
            priceVnd: price,
            travelFeeVnd: '0',
            totalVnd: price,
            resourceAllocation: allocation,
          });
        }
      }
    }
    slots.sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) ||
        a.providerApplicationId.localeCompare(b.providerApplicationId),
    );
    const unique = slots.filter(
      (slot, index) =>
        index === 0 ||
        slot.startsAt !== slots[index - 1].startsAt ||
        slot.providerApplicationId !== slots[index - 1].providerApplicationId,
    );
    return {
      context,
      slots: unique.slice(0, limit),
      blockers: unique.length ? [] : ['NO_AVAILABLE_SLOT'],
    };
  }
  publicPreview(query: AvailabilityQueryDto): Promise<AvailabilityResult> {
    return this.database.transaction('REPEATABLE READ', async (manager) => {
      const result = await this.plan(query, manager);
      return {
        timezone: BUSINESS_TIMEZONE,
        date: query.date,
        mode: 'AT_BRANCH',
        reservation: false,
        requestEnabled: true,
        blockers: result.blockers,
        slots: result.slots.map((slot) => ({
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          providerApplicationId: slot.providerApplicationId,
          providerName: slot.providerName,
          priceVnd: slot.priceVnd,
          travelFeeVnd: slot.travelFeeVnd,
          totalVnd: slot.totalVnd,
        })),
      };
    });
  }
  earliest(query: AvailabilityQueryDto): Promise<AvailabilityResult> {
    return this.database.transaction('REPEATABLE READ', async (manager) => {
      const at = new Date(),
        first = await this.plan(query, manager, at, 1);
      let result = first,
        date = query.date;
      const end = first.context
        ? plusDays(localDate(at), first.context.setting.horizonDays)
        : query.date;
      if (
        first.context &&
        query.date >= localDate(at) &&
        !first.blockers.includes('NO_ELIGIBLE_PROVIDER')
      ) {
        for (let day = 1; !result.slots.length && day < 14; day++) {
          const nextDate = plusDays(query.date, day);
          if (nextDate > end) break;
          date = nextDate;
          result = await this.plan({ ...query, date }, manager, at, 1);
        }
      }
      return {
        timezone: BUSINESS_TIMEZONE,
        date,
        search: {
          fromDate: query.date,
          throughDate: date,
          hasMoreDates: !result.slots.length && date < end,
        },
        mode: 'AT_BRANCH',
        reservation: false,
        requestEnabled: true,
        blockers: result.blockers,
        slots: result.slots.map((slot) => ({
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          providerApplicationId: slot.providerApplicationId,
          providerName: slot.providerName,
          priceVnd: slot.priceVnd,
          travelFeeVnd: slot.travelFeeVnd,
          totalVnd: slot.totalVnd,
        })),
      };
    });
  }
}
