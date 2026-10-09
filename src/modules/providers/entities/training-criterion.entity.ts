import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
@Entity('provider_training_criteria')
@Unique(['courseId', 'code'])
export class TrainingCriterion {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) courseId!: string;
  @Column({ type: 'uuid', nullable: true }) serviceId!: string | null;
  @Column({ type: 'varchar', length: 80 }) code!: string;
  @Column({ type: 'varchar', length: 180 }) title!: string;
  @Column({ type: 'smallint' }) minimumScore!: number;
  @Column({ type: 'boolean', default: true }) isRequired!: boolean;
  @Column({ type: 'boolean', default: true }) isActive!: boolean;
}
