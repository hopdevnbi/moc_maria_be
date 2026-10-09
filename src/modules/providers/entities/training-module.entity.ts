import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
@Entity('provider_training_modules')
@Unique(['courseId', 'code'])
export class TrainingModule {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) courseId!: string;
  @Column({ type: 'varchar', length: 80 }) code!: string;
  @Column({ type: 'varchar', length: 180 }) title!: string;
  @Column({ type: 'smallint' }) sortOrder!: number;
  @Column({ type: 'boolean', default: true }) isRequired!: boolean;
  @Column({ type: 'boolean', default: true }) isActive!: boolean;
}
