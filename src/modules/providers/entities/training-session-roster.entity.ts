import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
@Entity('provider_training_session_roster')
@Unique(['sessionId', 'enrollmentId'])
export class TrainingSessionRoster {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) sessionId!: string;
  @Column({ type: 'uuid' }) enrollmentId!: string;
  @Column({ type: 'boolean', default: true }) isActive!: boolean;
  @Column({ type: 'uuid' }) addedBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) addedAt!: Date;
}
