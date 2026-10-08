import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('branch_exception_hours')
@Index('uq_branch_exception_date', ['branchId', 'date'], { unique: true })
export class BranchExceptionHour {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  branchId!: string;

  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'boolean', default: true })
  isClosed!: boolean;

  @Column({ type: 'smallint', nullable: true })
  opensAtMinute!: number | null;

  @Column({ type: 'smallint', nullable: true })
  closesAtMinute!: number | null;

  @Column({ type: 'varchar', length: 240, nullable: true })
  note!: string | null;
}
