import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('provider_training_assessments')
export class TrainingAssessment {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) enrollmentId!: string;
  @Column({ type: 'char', length: 64 }) evidenceFingerprint!: string;
  @Column({ type: 'smallint' }) attendancePercent!: number;
  @Column({ type: 'boolean' }) passed!: boolean;
  @Column({ type: 'timestamptz' }) validUntil!: Date;
  @Column({ type: 'varchar', length: 100 }) evidenceReference!: string;
  @Column({ type: 'varchar', length: 500 }) reason!: string;
  @Column({ type: 'uuid' }) assessedBy!: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) assessedAt!: Date;
  @Column({ type: 'jsonb' }) snapshot!: Record<string, unknown>;
}
