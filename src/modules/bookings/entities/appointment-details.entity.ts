import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import type { AppointmentStatus } from './appointment.entity';
@Entity('appointment_items')
export class AppointmentItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) appointmentId!: string;
  @Column({ type: 'uuid' }) serviceId!: string;
  @Column({ type: 'uuid' }) variantId!: string;
  @Column({ type: 'varchar', length: 160 }) serviceName!: string;
  @Column({ type: 'varchar', length: 160 }) variantName!: string;
  @Column({ type: 'integer' }) durationMinutes!: number;
  @Column({ type: 'integer' }) bufferBeforeMinutes!: number;
  @Column({ type: 'integer' }) bufferAfterMinutes!: number;
  @Column({ type: 'bigint' }) priceVnd!: string;
}
@Entity('appointment_staff')
export class AppointmentStaff {
  @PrimaryColumn({ type: 'uuid' }) appointmentId!: string;
  @PrimaryColumn({ type: 'uuid' }) providerApplicationId!: string;
}
@Entity('appointment_resources')
export class AppointmentResource {
  @PrimaryColumn({ type: 'uuid' }) appointmentId!: string;
  @PrimaryColumn({ type: 'uuid' }) resourceId!: string;
  @Column({ type: 'smallint' }) units!: number;
}
@Entity('appointment_quotes')
export class AppointmentQuote {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) appointmentId!: string;
  @Column({ type: 'integer' }) revision!: number;
  @Column({ type: 'bigint' }) servicePriceVnd!: string;
  @Column({ type: 'bigint' }) travelFeeVnd!: string;
  @Column({ type: 'bigint' }) extraFeeVnd!: string;
  @Column({ type: 'bigint' }) discountVnd!: string;
  @Column({ type: 'bigint' }) totalVnd!: string;
  @Column({ type: 'jsonb' }) snapshot!: Record<string, unknown>;
  @Column({ type: 'varchar', length: 500 }) reason!: string;
  @Column({ type: 'uuid' }) createdBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @Column({ type: 'uuid', nullable: true }) acceptedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) acceptedAt!: Date | null;
}
@Entity('appointment_status_history')
export class AppointmentStatusHistory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) appointmentId!: string;
  @Column({ type: 'varchar', length: 24, nullable: true })
  previousStatus!: AppointmentStatus | null;
  @Column({ type: 'varchar', length: 24 }) nextStatus!: AppointmentStatus;
  @Column({ type: 'uuid' }) actorUserId!: string;
  @Column({ type: 'varchar', length: 500 }) reason!: string;
  @Column({ type: 'jsonb' }) metadata!: Record<string, unknown>;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
