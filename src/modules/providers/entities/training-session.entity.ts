import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('provider_training_sessions')
export class TrainingSession {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) moduleId!: string;
  @Column({ type: 'uuid', nullable: true }) branchId!: string | null;
  @Column({ type: 'uuid' }) instructorUserId!: string;
  @Column({ type: 'timestamptz' }) startsAt!: Date;
  @Column({ type: 'timestamptz' }) endsAt!: Date;
  @Column({ type: 'varchar', length: 16, default: 'PLANNED' }) status!:
    'PLANNED' | 'COMPLETED' | 'CANCELLED';
  @Column({ type: 'varchar', length: 100, nullable: true }) completionReference!: string | null;
  @Column({ type: 'uuid', nullable: true }) recordedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) recordedAt!: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
