import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Branch } from '../catalog/entities/branch.entity';
import { ServiceVariant } from '../catalog/entities/service-variant.entity';
import { BranchService } from '../catalog/entities/branch-service.entity';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { BookingVariantSetting } from './entities/booking-variant-setting.entity';
import { SaveBookingSettingDto } from './dto/availability.dto';
@Injectable()
export class BookingSettingsService {
  constructor(private readonly database: DataSource) {}
  list(): Promise<BookingVariantSetting[]> {
    return this.database.manager.find(BookingVariantSetting, {
      order: { branchId: 'ASC', variantId: 'ASC', mode: 'ASC' },
    });
  }
  save(actorId: string, dto: SaveBookingSettingDto): Promise<BookingVariantSetting> {
    if (
      !dto.configurationConfirmed ||
      dto.reason.trim().length < 3 ||
      new Set(dto.resourceRequirements.map((r) => r.kind)).size !==
        dto.resourceRequirements.length ||
      (dto.mode === 'AT_HOME' && dto.resourceRequirements.length)
    )
      throw new BadRequestException(
        'Cần xác nhận cấu hình tài nguyên đúng hình thức; không lặp loại tài nguyên.',
      );
    return this.database.transaction(async (manager) => {
      const branch = await manager.findOne(Branch, {
        where: { id: dto.branchId },
        lock: { mode: 'pessimistic_write' },
      });
      const variant = await manager.findOneBy(ServiceVariant, { id: dto.variantId });
      if (
        !branch ||
        !variant ||
        !(await manager.findOneBy(BranchService, {
          branchId: branch.id,
          serviceId: variant.serviceId,
        }))
      )
        throw new NotFoundException('Cần gói dịch vụ đã được liên kết với cơ sở.');
      const previous = await manager.findOneBy(BookingVariantSetting, {
        variantId: variant.id,
        branchId: branch.id,
        mode: dto.mode,
      });
      const { configurationConfirmed: _confirmed, reason, ...config } = dto;
      const saved = await manager.save(BookingVariantSetting, {
        ...previous,
        ...config,
        reason: reason.trim(),
        reviewedBy: actorId,
        reviewedAt: new Date(),
      });
      await manager.save(AuditLog, {
        actorUserId: actorId,
        event: 'booking.setting.reviewed',
        metadata: { settingId: saved.id, previous, reason: reason.trim() },
      });
      return saved;
    });
  }
}
