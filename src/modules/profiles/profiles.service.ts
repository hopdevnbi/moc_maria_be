import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { Customer } from '../identity/entities/customer.entity';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { User } from '../identity/entities/user.entity';
import { normalizeEmail, normalizePhone } from '../identity/identity-normalization';
import { IdentityService } from '../identity/identity.service';
import { ProviderApplication } from '../providers/entities/provider-application.entity';
import { ProviderContactVerification } from '../providers/entities/provider-contact-verification.entity';
import type { AuthUserContext } from '../identity/identity.types';
import type { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import type { UpdateStaffProfileDto } from './dto/update-staff-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly identityService: IdentityService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(StaffProfile)
    private readonly staffProfiles: Repository<StaffProfile>,
  ) {}

  async getCustomer(userId: string): Promise<unknown> {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { customer: true, userRoles: { role: true } },
    });
    if (!user?.customer) {
      throw new NotFoundException('Không tìm thấy hồ sơ khách hàng.');
    }
    return this.toCustomerView(user);
  }

  async updateCustomer(userId: string, dto: UpdateCustomerProfileDto): Promise<unknown> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const users = manager.getRepository(User);
        const customers = manager.getRepository(Customer);
        const application = await manager.findOne(ProviderApplication, {
          where: { userId },
          lock: { mode: 'pessimistic_write' },
        });
        const user = await users.findOne({
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        });
        const customer = await customers.findOne({ where: { userId } });
        if (!user || !customer) throw new NotFoundException('Không tìm thấy hồ sơ khách hàng.');

        const previousEmail = user.email;
        const previousPhone = user.phone;
        if (dto.displayName !== undefined) user.displayName = dto.displayName.trim();
        if (dto.email !== undefined) user.email = normalizeEmail(dto.email);
        if (dto.phone !== undefined) user.phone = normalizePhone(dto.phone);
        if (!user.email && !user.phone) {
          throw new BadRequestException('Tài khoản phải giữ lại email hoặc số điện thoại.');
        }

        if (dto.birthday !== undefined) customer.birthday = dto.birthday || null;
        if (dto.avatarUrl !== undefined) customer.avatarUrl = dto.avatarUrl || null;
        if (dto.contactPreferences !== undefined) {
          customer.contactPreferences = dto.contactPreferences;
        }

        await users.save(user);
        if (application) {
          for (const channel of ['EMAIL', 'PHONE'] as const) {
            if (channel === 'EMAIL' ? previousEmail === user.email : previousPhone === user.phone)
              continue;
            await manager.update(
              ProviderContactVerification,
              { providerApplicationId: application.id, channel },
              { revokedAt: new Date() },
            );
            await manager.save(AuditLog, {
              event: 'provider.contact.invalidated',
              actorUserId: userId,
              targetUserId: userId,
              metadata: { applicationId: application.id, channel, reason: 'CONTACT_CHANGED' },
            });
          }
        }
        await customers.save(customer);
        await manager.getRepository(AuditLog).insert({
          event: 'CUSTOMER_PROFILE_UPDATED',
          actorUserId: userId,
          targetUserId: userId,
          metadata: {},
        });
      });
      return this.getCustomer(userId);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Email hoặc số điện thoại đã được sử dụng.');
      }
      throw error;
    }
  }

  async getStaff(user: AuthUserContext): Promise<unknown> {
    const profile = await this.staffProfiles.findOne({ where: { userId: user.id } });
    if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ nhân viên.');
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      roles: user.roles,
      permissions: user.permissions,
      staff: {
        id: profile.id,
        publicName: profile.publicName,
        isActive: profile.isActive,
        isPublic: profile.isPublic,
        avatarUrl: profile.avatarUrl,
        bio: profile.bio,
      },
    };
  }

  async updateStaff(user: AuthUserContext, dto: UpdateStaffProfileDto): Promise<unknown> {
    const profile = await this.staffProfiles.findOne({ where: { userId: user.id } });
    if (!profile) throw new NotFoundException('Không tìm thấy hồ sơ nhân viên.');

    if (dto.publicName !== undefined) profile.publicName = dto.publicName.trim();
    if (dto.avatarUrl !== undefined) profile.avatarUrl = dto.avatarUrl || null;
    if (dto.bio !== undefined) profile.bio = dto.bio?.trim() || null;
    await this.staffProfiles.save(profile);
    await this.identityService.writeAudit({
      event: 'STAFF_PROFILE_UPDATED',
      actorUserId: user.id,
      targetUserId: user.id,
    });
    return this.getStaff(user);
  }

  private toCustomerView(user: User): Record<string, unknown> {
    const customer = user.customer;
    if (!customer) throw new NotFoundException('Không tìm thấy hồ sơ khách hàng.');
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      roles: user.userRoles.map((item) => item.role.name).sort(),
      customer: {
        id: customer.id,
        birthday: customer.birthday,
        avatarUrl: customer.avatarUrl,
        contactPreferences: customer.contactPreferences,
      },
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      String((error as { code?: unknown }).code) === '23505'
    );
  }
}
