import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('provider_date_schedules')
export class ProviderDateSchedule {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) providerApplicationId!: string;
  @Column({ type: 'uuid', nullable: true }) branchId!: string | null;
  @Column({ type: 'date' }) date!: string;
  @Column({ type: 'varchar', length: 16 }) kind!: 'OVERRIDE' | 'TIME_OFF';
  @Column({ type: 'smallint' }) startsAtMinute!: number;
  @Column({ type: 'smallint' }) endsAtMinute!: number;
  @Column({ type: 'boolean', default: true }) isActive!: boolean;
}
