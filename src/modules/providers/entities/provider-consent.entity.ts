import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn, Unique } from 'typeorm';

export const PROVIDER_CONSENT_VERSION = 'provider-consent-v1';
export const PROVIDER_CONSENT_SCOPES = ['APPLICATION_REVIEW', 'PUBLIC_PROFILE'] as const;
export type ProviderConsentScope = (typeof PROVIDER_CONSENT_SCOPES)[number];

@Entity('provider_consents')
@Unique(['providerApplicationId', 'scope'])
export class ProviderConsent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) providerApplicationId!: string;
  @Column({ type: 'varchar', length: 32 }) scope!: ProviderConsentScope;
  @Column({ type: 'varchar', length: 60 }) version!: string;
  @Column({ type: 'boolean' }) granted!: boolean;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
