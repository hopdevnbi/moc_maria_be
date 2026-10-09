import { Column, Entity, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

export type ProviderContactChannel = 'EMAIL' | 'PHONE';

@Entity('provider_contact_verifications')
export class ProviderContactVerification {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) providerApplicationId!: string;
  @Column({ type: 'varchar', length: 8 }) channel!: ProviderContactChannel;
  @Column({ type: 'varchar', length: 64 }) contactHash!: string;
  @Column({ type: 'varchar', length: 100 }) evidenceReference!: string;
  @Column({ type: 'uuid' }) verifiedBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) verifiedAt!: Date;
  @Column({ type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
}
