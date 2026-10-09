import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('service_provider_policies')
@Unique('uq_service_provider_policy_scope', ['serviceId', 'branchId', 'mode', 'jurisdictionCode'])
export class ServiceProviderPolicy {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) serviceId!: string;
  @Column({ type: 'uuid' }) branchId!: string;
  @Column({ type: 'uuid' }) courseId!: string;
  @Column({ type: 'varchar', length: 16 }) mode!: 'ON_SITE' | 'AT_HOME';
  @Column({ type: 'varchar', length: 64 }) jurisdictionCode!: string;
  @Column({ type: 'varchar', length: 120 }) territoryLabel!: string;
  @Column({ type: 'varchar', length: 24 }) legalRequirement!: 'LICENSE_REQUIRED' | 'NOT_REQUIRED';
  @Column({ type: 'varchar', length: 100 }) legalReviewReference!: string;
  @Column({ type: 'timestamptz' }) validUntil!: Date;
  @Column({ type: 'boolean', default: false }) isActive!: boolean;
  @Column({ type: 'uuid' }) reviewedBy!: string;
  @Column({ type: 'timestamptz' }) reviewedAt!: Date;
}
