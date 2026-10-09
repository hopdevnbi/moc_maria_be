import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('provider_training_courses')
export class TrainingCourse {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  @Column({ type: 'varchar', length: 80, unique: true })
  code!: string;
  @Column({ type: 'varchar', length: 180 })
  title!: string;
  @Column({ type: 'varchar', length: 1500, nullable: true })
  description!: string | null;
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
  @Column({ type: 'integer', default: 1 })
  requirementsRevision!: number;
}
