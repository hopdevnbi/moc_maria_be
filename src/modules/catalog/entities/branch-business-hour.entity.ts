import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('branch_business_hours')
@Index('uq_branch_hours_weekday', ['branchId', 'weekday'], { unique: true })
export class BranchBusinessHour {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  @Column({ type: 'uuid' })
  branchId!: string;
  @Column({ type: 'smallint' })
  weekday!: number;
  @Column({ type: 'smallint' })
  opensAtMinute!: number;
  @Column({ type: 'smallint' })
  closesAtMinute!: number;
}
