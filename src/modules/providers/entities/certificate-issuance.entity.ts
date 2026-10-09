import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
@Entity('provider_certificate_issuances')
export class CertificateIssuance {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) certificateId!: string;
  @Column({ type: 'varchar', length: 60, unique: true }) certificateNumber!: string;
  @Column({ type: 'varchar', length: 16 }) kind!: 'IMPORTED' | 'ISSUED' | 'RENEWED';
  @Column({ type: 'uuid', nullable: true }) assessmentId!: string | null;
  @Column({ type: 'timestamptz' }) issuedAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) expiresAt!: Date | null;
  @Column({ type: 'uuid' }) issuedBy!: string;
  @Column({ type: 'varchar', length: 500 }) reason!: string;
  @Column({ type: 'jsonb', nullable: true }) previousSnapshot!: Record<string, unknown> | null;
}
