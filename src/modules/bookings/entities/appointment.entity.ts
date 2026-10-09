import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { BookingMode } from './booking-variant-setting.entity';
export type AppointmentStatus =
  | 'REQUESTED'
  | 'ACCEPTED'
  | 'CUSTOMER_CONFIRMED'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'IN_SERVICE'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'NO_SHOW';
export interface BookingDestination {
  address: string;
  latitude: number;
  longitude: number;
  jurisdictionCode: string;
}
@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) customerUserId!: string;
  @Column({ type: 'uuid' }) createdBy!: string;
  @Column({ type: 'uuid' }) branchId!: string;
  @Column({ type: 'varchar', length: 16 }) mode!: BookingMode;
  @Column({ type: 'varchar', length: 24 }) status!: AppointmentStatus;
  @Column({ type: 'timestamptz' }) startsAt!: Date;
  @Column({ type: 'timestamptz' }) endsAt!: Date;
  @Column({ type: 'timestamptz' }) blockedStartsAt!: Date;
  @Column({ type: 'timestamptz' }) blockedEndsAt!: Date;
  @Column({ type: 'timestamptz' }) requestExpiresAt!: Date;
  @Column({ type: 'integer' }) currentQuoteRevision!: number;
  @Column({ type: 'varchar', length: 80 }) idempotencyKey!: string;
  @Column({ type: 'char', length: 64 }) requestFingerprint!: string;
  @Column({ type: 'integer' }) version!: number;
  @Column({ type: 'varchar', length: 16 }) source!: 'WEB' | 'ADMIN';
  @Column({ type: 'varchar', length: 500, nullable: true }) notes!: string | null;
  @Column({ type: 'jsonb', nullable: true }) destination!: BookingDestination | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
