import { Equals, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PROVIDER_CONSENT_VERSION } from '../entities/provider-consent.entity';
import { PROVIDER_APPLICATION_STATUSES } from '../entities/provider-application.entity';
import type { ProviderApplicationStatus } from '../entities/provider-application.entity';

export class ApplyProviderDto {
  // Optional for legacy clients; missing consent blocks approval/public eligibility.
  @IsOptional()
  @Equals(PROVIDER_CONSENT_VERSION)
  applicationConsentVersion?: string;
  @IsString()
  @Length(2, 160)
  publicName!: string;
  @IsOptional()
  @IsString()
  @Length(1, 500)
  introduction?: string;
  @IsOptional()
  @IsString()
  @Length(1, 160)
  serviceArea?: string;
}

export class ReviewProviderDto {
  @IsIn([...PROVIDER_APPLICATION_STATUSES])
  status!: ProviderApplicationStatus;
  @IsString()
  @Length(1, 500)
  note!: string;
}

export class UpdateOwnApplicationDto {
  @IsString()
  @Length(2, 160)
  publicName!: string;
  @IsString()
  @Length(1, 500)
  introduction!: string;
  @IsString()
  @Length(1, 160)
  serviceArea!: string;
}
