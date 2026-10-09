import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('provider_skills')
@Unique('uq_provider_skill_service', ['providerApplicationId', 'serviceId'])
export class ProviderSkill {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) providerApplicationId!: string;
  @Column({ type: 'uuid' }) serviceId!: string;
  @Column({ type: 'uuid' }) certificateId!: string;
  @Column({ type: 'boolean', default: true }) isActive!: boolean;
  @Column({ type: 'uuid' }) reviewedBy!: string;
  @Column({ type: 'timestamptz' }) reviewedAt!: Date;
}
