import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const PROVIDER_APPLICATION_STATUSES = [
  'APPLIED',
  'REVIEWING',
  'TRAINING',
  'ASSESSMENT',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type ProviderApplicationStatus = (typeof PROVIDER_APPLICATION_STATUSES)[number];

@Entity('provider_applications')
export class ProviderApplication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  @Column({ type: 'uuid', unique: true })
  userId!: string;
  @Column({ type: 'varchar', length: 160 })
  publicName!: string;
  @Column({ type: 'varchar', length: 500, nullable: true })
  introduction!: string | null;
  @Column({ type: 'varchar', length: 160, nullable: true })
  serviceArea!: string | null;
  @Column({ type: 'varchar', length: 24, default: 'APPLIED' })
  status!: ProviderApplicationStatus;
  @Column({ type: 'uuid', nullable: true })
  reviewedBy!: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true })
  reviewNote!: string | null;
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
