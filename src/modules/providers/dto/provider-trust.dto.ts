import { Equals, IsBoolean, IsIn, IsString, Length, Matches } from 'class-validator';
import {
  PROVIDER_CONSENT_SCOPES,
  PROVIDER_CONSENT_VERSION,
} from '../entities/provider-consent.entity';
import type { ProviderConsentScope } from '../entities/provider-consent.entity';
import type { ProviderContactChannel } from '../entities/provider-contact-verification.entity';

export class SaveProviderConsentDto {
  @IsIn([...PROVIDER_CONSENT_SCOPES]) scope!: ProviderConsentScope;
  @Equals(PROVIDER_CONSENT_VERSION) version!: string;
  @IsBoolean() granted!: boolean;
}

export class VerifyProviderContactDto {
  @IsIn(['EMAIL', 'PHONE']) channel!: ProviderContactChannel;
  @IsString() @Length(3, 320) contactValue!: string;
  @IsString()
  @Length(3, 100)
  @Matches(/^[A-Za-z0-9_-]+$/)
  evidenceReference!: string;
  @Equals(true) confirmedByContact!: boolean;
}
