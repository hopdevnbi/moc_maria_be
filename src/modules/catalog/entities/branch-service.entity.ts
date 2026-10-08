import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('branch_services')
@Unique('uq_branch_service', ['branchId', 'serviceId'])
export class BranchService {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  @Column({ type: 'uuid' })
  branchId!: string;
  @Column({ type: 'uuid' })
  serviceId!: string;
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
  @Column({ type: 'bigint', nullable: true })
  priceOverrideVnd!: string | null;
}
