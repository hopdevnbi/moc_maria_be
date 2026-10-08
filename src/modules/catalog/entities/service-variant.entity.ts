import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('service_variants')
export class ServiceVariant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  @Column({ type: 'uuid' })
  serviceId!: string;
  @Column({ type: 'varchar', length: 160 })
  name!: string;
  @Column({ type: 'int' })
  durationMinutes!: number;
  @Column({ type: 'bigint' })
  priceVnd!: string;
  @Column({ type: 'int', default: 0 })
  bufferBeforeMinutes!: number;
  @Column({ type: 'int', default: 0 })
  bufferAfterMinutes!: number;
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
