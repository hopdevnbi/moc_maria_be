import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('provider_service_grants')
@Unique('uq_provider_service_grant_policy', ['providerApplicationId', 'policyId'])
export class ProviderServiceGrant {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) providerApplicationId!: string;
  @Column({ type: 'uuid' }) policyId!: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) credentialReference!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) credentialValidUntil!: Date | null;
  @Column({ type: 'smallint' }) travelBufferMinutes!: number;
  @Column({ type: 'bigint' }) travelFeeVnd!: string;
  @Column({ type: 'smallint', nullable: true }) maxRadiusKm!: number | null;
  @Column({ type: 'boolean', default: false }) isActive!: boolean;
  @Column({ type: 'uuid' }) reviewedBy!: string;
  @Column({ type: 'timestamptz' }) reviewedAt!: Date;
}
