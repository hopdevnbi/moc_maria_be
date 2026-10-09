import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('provider_branch_assignments')
@Unique('uq_provider_branch_assignment', ['providerApplicationId', 'branchId'])
export class ProviderBranchAssignment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) providerApplicationId!: string;
  @Column({ type: 'uuid' }) branchId!: string;
  @Column({ type: 'boolean', default: true }) isActive!: boolean;
}
