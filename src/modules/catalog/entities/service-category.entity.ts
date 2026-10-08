import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('service_categories')
export class ServiceCategory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  @Column({ type: 'varchar', length: 160 })
  name!: string;
  @Column({ type: 'varchar', length: 100, unique: true })
  slug!: string;
  @Column({ type: 'text', nullable: true })
  description!: string | null;
  @Column({ type: 'int', default: 0 })
  sortOrder!: number;
  @Column({ type: 'boolean', default: false })
  isPublished!: boolean;
}
