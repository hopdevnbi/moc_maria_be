import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../identity/entities/user.entity';
import { StaffCheckIn } from './staff-check-in.entity';

@Entity('staff_coin_ledger')
export class StaffCoinLedger {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid', unique: true })
  checkInId!: string;

  @Column({ type: 'integer' })
  amount!: number;

  @Column({ type: 'varchar', length: 32, default: 'CHECK_IN' })
  reason!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToOne(() => StaffCheckIn, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'check_in_id' })
  checkIn!: StaffCheckIn;
}
