import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('provider_public_profiles')
export class ProviderPublicProfile {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid', unique: true }) providerApplicationId!: string;
  @Column({ type: 'varchar', length: 120, unique: true }) slug!: string;
  @Column({ type: 'varchar', length: 120 }) title!: string;
  @Column({ type: 'smallint', nullable: true }) yearsExperience!: number | null;
  @Column({ type: 'boolean', default: false }) isPublished!: boolean;
  @Column({ type: 'uuid' }) reviewedBy!: string;
  @Column({ type: 'timestamptz' }) reviewedAt!: Date;
}
