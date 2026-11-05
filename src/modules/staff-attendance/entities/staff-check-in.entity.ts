import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Branch } from '../../catalog/entities/branch.entity';
import { User } from '../../identity/entities/user.entity';

export type CheckInStatus =
  'IN_RANGE' | 'OUT_OF_RANGE' | 'LOCATION_NOT_CONFIGURED' | 'LOCATION_UNAVAILABLE';

@Entity('staff_check_ins')
@Index('uq_staff_checkin_user_local_date', ['userId', 'localDate'], { unique: true })
export class StaffCheckIn {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid' })
  branchId!: string;

  @Column({ type: 'date' })
  localDate!: string;

  @Column({ type: 'double precision', nullable: true })
  latitude!: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude!: number | null;

  @Column({ type: 'double precision', nullable: true })
  accuracyMeters!: number | null;

  @Column({ type: 'double precision', nullable: true })
  distanceMeters!: number | null;

  @Column({ type: 'varchar', length: 40 })
  status!: CheckInStatus;

  @Column({ type: 'integer', default: 0 })
  coinsEarned!: number;

  @Column({ type: 'varchar', length: 12, default: 'STAFF' })
  checkinCategory!: 'STAFF' | 'CUSTOMER';

  /** Opaque browser installation key hash; never return to clients. */
  @Column({ type: 'char', length: 64, nullable: true, select: false })
  customerDeviceHash!: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  selfieUrl!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branch_id' })
  branch!: Branch;
}
