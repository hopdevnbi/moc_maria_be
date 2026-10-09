import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('provider_training_attendance')
export class TrainingAttendance {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid', unique: true }) rosterId!: string;
  @Column({ type: 'varchar', length: 16 }) status!: 'PRESENT' | 'ABSENT' | 'EXCUSED';
  @Column({ type: 'smallint' }) attendedMinutes!: number;
  @Column({ type: 'varchar', length: 100 }) evidenceReference!: string;
  @Column({ type: 'uuid' }) markedBy!: string;
  @Column({ type: 'timestamptz' }) markedAt!: Date;
}
