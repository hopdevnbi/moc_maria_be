import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { User } from '../identity/entities/user.entity';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { normalizeEmail, normalizePhone } from '../identity/identity-normalization';
import { ProviderApplication } from './entities/provider-application.entity';
import { ProviderConsent, PROVIDER_CONSENT_VERSION } from './entities/provider-consent.entity';
import { ProviderContactVerification } from './entities/provider-contact-verification.entity';
import type { ProviderContactChannel } from './entities/provider-contact-verification.entity';
import type { SaveProviderConsentDto, VerifyProviderContactDto } from './dto/provider-trust.dto';

export interface ProviderTrustSummary {
  consentVersion: string;
  applicationConsent: boolean;
  publicConsent: boolean;
  contactVerified: boolean;
  profileComplete: boolean;
  reviewReady: boolean;
  contacts: Array<{
    id: string;
    channel: ProviderContactChannel;
    verifiedAt: Date;
    revokedAt: Date | null;
    isCurrent: boolean;
    evidenceReference?: string;
    verifiedBy?: string;
  }>;
  consents: Array<{ scope: string; version: string; granted: boolean; updatedAt: Date }>;
  bookable: boolean;
  bookingBlockers: string[];
}

@Injectable()
export class ProviderTrustService {
  constructor(private readonly dataSource: DataSource) {}

  async recordConsent(
    manager: EntityManager,
    application: ProviderApplication,
    dto: SaveProviderConsentDto,
  ): Promise<void> {
    await manager.upsert(
      ProviderConsent,
      {
        providerApplicationId: application.id,
        scope: dto.scope,
        version: dto.version,
        granted: dto.granted,
        updatedAt: new Date(),
      },
      ['providerApplicationId', 'scope'],
    );
    await manager.save(AuditLog, {
      event: 'provider.consent.updated',
      actorUserId: application.userId,
      targetUserId: application.userId,
      metadata: {
        applicationId: application.id,
        scope: dto.scope,
        version: dto.version,
        granted: dto.granted,
      },
    });
  }

  private hash(channel: ProviderContactChannel, contact: string): string {
    return createHash('sha256')
      .update(channel + ':' + contact)
      .digest('hex');
  }

  private async application(manager: EntityManager, id: string): Promise<ProviderApplication> {
    const application = await manager.findOne(ProviderApplication, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!application) throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
    return application;
  }

  async saveConsent(userId: string, dto: SaveProviderConsentDto): Promise<unknown> {
    const application = await this.dataSource
      .getRepository(ProviderApplication)
      .findOneBy({ userId });
    if (!application) throw new NotFoundException('Bạn chưa có hồ sơ ứng tuyển.');
    await this.dataSource.transaction(async (manager) => {
      await this.application(manager, application.id);
      await this.recordConsent(manager, application, dto);
    });
    return this.summary(application.id);
  }

  async verifyContact(
    id: string,
    actorId: string,
    dto: VerifyProviderContactDto,
  ): Promise<unknown> {
    await this.dataSource.transaction(async (manager) => {
      const application = await this.application(manager, id);
      if (application.userId === actorId)
        throw new BadRequestException('Không được tự xác minh liên hệ.');
      const user = await manager.findOneOrFail(User, {
        where: { id: application.userId },
        lock: { mode: 'pessimistic_write' },
      });
      const actual = dto.channel === 'EMAIL' ? user.email : user.phone;
      const supplied =
        dto.channel === 'EMAIL'
          ? normalizeEmail(dto.contactValue)
          : normalizePhone(dto.contactValue);
      if (!user.isActive || !actual || supplied !== actual)
        throw new BadRequestException('Kênh liên hệ không khớp tài khoản đang hoạt động.');
      await manager.update(
        ProviderContactVerification,
        { providerApplicationId: id, channel: dto.channel },
        { revokedAt: new Date() },
      );
      const verification = await manager.save(ProviderContactVerification, {
        providerApplicationId: id,
        channel: dto.channel,
        contactHash: this.hash(dto.channel, actual),
        evidenceReference: dto.evidenceReference,
        verifiedBy: actorId,
        revokedAt: null,
      });
      await manager.save(AuditLog, {
        event: 'provider.contact.verified',
        actorUserId: actorId,
        targetUserId: application.userId,
        metadata: {
          applicationId: id,
          verificationId: verification.id,
          channel: dto.channel,
          method: 'MANUAL_CONTACT_CONFIRMATION',
        },
      });
    });
    return this.summary(id);
  }

  async revokeContact(id: string, verificationId: string, actorId: string): Promise<unknown> {
    await this.dataSource.transaction(async (manager) => {
      const application = await this.application(manager, id);
      if (application.userId === actorId)
        throw new BadRequestException('Không được tự xử lý xác minh.');
      const verification = await manager.findOneBy(ProviderContactVerification, {
        id: verificationId,
        providerApplicationId: id,
      });
      if (!verification) throw new NotFoundException('Không tìm thấy xác minh.');
      if (!verification.revokedAt) {
        verification.revokedAt = new Date();
        await manager.save(verification);
        await manager.save(AuditLog, {
          event: 'provider.contact.revoked',
          actorUserId: actorId,
          targetUserId: application.userId,
          metadata: { applicationId: id, verificationId },
        });
      }
    });
    return this.summary(id);
  }

  async summary(
    id: string,
    manager = this.dataSource.manager,
    admin = false,
  ): Promise<ProviderTrustSummary> {
    const application = await manager.findOneBy(ProviderApplication, { id });
    if (!application) throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
    const user = await manager.findOneByOrFail(User, { id: application.userId });
    const [consents, contacts] = await Promise.all([
      manager.find(ProviderConsent, { where: { providerApplicationId: id } }),
      manager.find(ProviderContactVerification, {
        where: { providerApplicationId: id },
        order: { verifiedAt: 'DESC' },
      }),
    ]);
    const validConsent = (scope: string): boolean =>
      consents.some(
        (c) => c.scope === scope && c.granted && c.version === PROVIDER_CONSENT_VERSION,
      );
    const contactView = contacts.map((c) => {
      const actual = c.channel === 'EMAIL' ? user.email : user.phone;
      return {
        id: c.id,
        channel: c.channel,
        verifiedAt: c.verifiedAt,
        revokedAt: c.revokedAt,
        isCurrent: !c.revokedAt && !!actual && c.contactHash === this.hash(c.channel, actual),
        ...(admin ? { evidenceReference: c.evidenceReference, verifiedBy: c.verifiedBy } : {}),
      };
    });
    const contactVerified = contactView.some((c) => c.isCurrent);
    const applicationConsent = validConsent('APPLICATION_REVIEW');
    const publicConsent = validConsent('PUBLIC_PROFILE');
    const profileComplete = !!application.introduction?.trim() && !!application.serviceArea?.trim();
    return {
      consentVersion: PROVIDER_CONSENT_VERSION,
      applicationConsent,
      publicConsent,
      contactVerified,
      profileComplete,
      reviewReady: user.isActive && profileComplete && applicationConsent && contactVerified,
      contacts: contactView,
      consents: consents.map((c) => ({
        scope: c.scope,
        version: c.version,
        granted: c.granted,
        updatedAt: c.updatedAt,
      })),
      bookable: false,
      bookingBlockers: ['SKILLS_SCHEDULE_AND_SERVICE_ELIGIBILITY_PENDING'],
    };
  }

  async mySummary(userId: string): Promise<ProviderTrustSummary | null> {
    const application = await this.dataSource
      .getRepository(ProviderApplication)
      .findOneBy({ userId });
    return application ? this.summary(application.id) : null;
  }

  async assertApprovalReady(id: string, manager: EntityManager): Promise<void> {
    const application = await manager.findOneByOrFail(ProviderApplication, { id });
    await manager.findOneOrFail(User, {
      where: { id: application.userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!(await this.summary(id, manager)).reviewReady)
      throw new BadRequestException(
        'Cần hồ sơ đầy đủ, đồng ý xử lý hồ sơ và kênh liên hệ đã xác minh.',
      );
  }

  async publicEligibleIds(
    applications: ProviderApplication[],
    users: User[],
  ): Promise<Set<string>> {
    if (!applications.length) return new Set();
    const ids = applications.map((a) => a.id);
    const [consents, contacts] = await Promise.all([
      this.dataSource.manager.find(ProviderConsent, { where: { providerApplicationId: In(ids) } }),
      this.dataSource.manager.find(ProviderContactVerification, {
        where: { providerApplicationId: In(ids) },
      }),
    ]);
    return new Set(
      applications
        .filter((a) => {
          const user = users.find((u) => u.id === a.userId);
          return (
            !!user &&
            !!a.introduction?.trim() &&
            !!a.serviceArea?.trim() &&
            ['APPLICATION_REVIEW', 'PUBLIC_PROFILE'].every((scope) =>
              consents.some(
                (c) =>
                  c.providerApplicationId === a.id &&
                  c.scope === scope &&
                  c.granted &&
                  c.version === PROVIDER_CONSENT_VERSION,
              ),
            ) &&
            contacts.some((c) => {
              const value = c.channel === 'EMAIL' ? user.email : user.phone;
              return (
                c.providerApplicationId === a.id &&
                !c.revokedAt &&
                !!value &&
                c.contactHash === this.hash(c.channel, value)
              );
            })
          );
        })
        .map((a) => a.id),
    );
  }
}
