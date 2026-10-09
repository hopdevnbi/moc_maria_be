import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('provider_operating_reviews')
export class ProviderOperatingReview {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid', unique: true }) providerApplicationId!: string;
  @Column({ type: 'varchar', length: 16 }) providerKind!: 'WELLNESS' | 'SPECIALIST';
  @Column({ type: 'varchar', length: 16 }) qualityStatus!:
    'ACTIVE' | 'WATCHLIST' | 'PAUSED' | 'SUSPENDED';
  @Column({ type: 'uuid' }) reviewedBy!: string;
  @Column({ type: 'timestamptz' }) reviewedAt!: Date;
}
