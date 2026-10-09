import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('provider_weekly_shifts')
export class ProviderWeeklyShift {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) providerApplicationId!: string;
  @Column({ type: 'uuid' }) branchId!: string;
  @Column({ type: 'smallint' }) weekday!: number;
  @Column({ type: 'smallint' }) startsAtMinute!: number;
  @Column({ type: 'smallint' }) endsAtMinute!: number;
  @Column({ type: 'boolean', default: true }) isActive!: boolean;
}
