import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type EnrollmentStatus = 'ENROLLED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

@Entity('provider_training_enrollments')
@Unique('uq_provider_course_enrollment', ['providerApplicationId', 'courseId'])
export class TrainingEnrollment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  @Column({ type: 'uuid' })
  providerApplicationId!: string;
  @Column({ type: 'uuid' })
  courseId!: string;
  @Column({ type: 'varchar', length: 16, default: 'ENROLLED' })
  status!: EnrollmentStatus;
  @Column({ type: 'smallint', default: 0 })
  attendancePercent!: number;
  @Column({ type: 'boolean', default: false })
  assessmentPassed!: boolean;
  @Column({ type: 'uuid', nullable: true })
  assessedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true })
  assessedAt!: Date | null;
  @Column({ type: 'uuid', nullable: true })
  latestAssessmentId!: string | null;
}
