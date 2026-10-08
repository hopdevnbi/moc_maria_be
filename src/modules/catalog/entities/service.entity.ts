import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('services')
export class Service {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  @Column({ type: 'uuid' })
  categoryId!: string;
  @Column({ type: 'varchar', length: 160 })
  name!: string;
  @Column({ type: 'varchar', length: 120, unique: true })
  slug!: string;
  @Column({ type: 'text', nullable: true })
  description!: string | null;
  @Column({ type: 'boolean', default: false })
  isPublished!: boolean;
}
