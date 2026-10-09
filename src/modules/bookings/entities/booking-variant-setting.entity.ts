import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
export type BookingMode = 'AT_BRANCH' | 'AT_HOME';
export interface ResourceRequirement {
  kind: 'ROOM' | 'EQUIPMENT';
  quantity: number;
}
@Entity('booking_variant_settings')
@Unique(['variantId', 'branchId', 'mode'])
export class BookingVariantSetting {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) variantId!: string;
  @Column({ type: 'uuid' }) branchId!: string;
  @Column({ type: 'varchar', length: 16 }) mode!: BookingMode;
  @Column({ type: 'boolean' }) isEnabled!: boolean;
  @Column({ type: 'smallint' }) slotStepMinutes!: number;
  @Column({ type: 'integer' }) leadMinutes!: number;
  @Column({ type: 'smallint' }) horizonDays!: number;
  @Column({ type: 'smallint' }) requestTtlMinutes!: number;
  @Column({ type: 'jsonb' }) resourceRequirements!: ResourceRequirement[];
  @Column({ type: 'uuid' }) reviewedBy!: string;
  @Column({ type: 'timestamptz' }) reviewedAt!: Date;
  @Column({ type: 'varchar', length: 500 }) reason!: string;
}
