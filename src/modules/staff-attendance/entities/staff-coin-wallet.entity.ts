import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../identity/entities/user.entity';

@Entity('staff_coin_wallets')
export class StaffCoinWallet {
  @PrimaryColumn({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'integer', default: 0 })
  balance!: number;

  @Column({ type: 'integer', default: 0 })
  totalEarned!: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
