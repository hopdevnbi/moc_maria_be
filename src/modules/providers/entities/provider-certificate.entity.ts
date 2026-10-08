import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('provider_training_certificates')
@Unique('uq_training_provider_course', ['providerApplicationId', 'courseCode'])
export class ProviderCertificate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  @Column({ type: 'uuid' })
  providerApplicationId!: string;
  @Column({ type: 'varchar', length: 80 })
  courseCode!: string;
  @Column({ type: 'varchar', length: 160 })
  title!: string;
  @Column({ type: 'varchar', length: 60, unique: true })
  certificateNumber!: string;
  @Column({ type: 'timestamptz' })
  issuedAt!: Date;
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
  @Column({ type: 'uuid' })
  issuedBy!: string;
}
