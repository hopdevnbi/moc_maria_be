import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('branch_resources')
@Index('uq_branch_resource_code', ['branchId', 'code'], { unique: true })
export class BranchResource {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
  @Column({ type: 'uuid' })
  branchId!: string;
  @Column({ type: 'varchar', length: 40 })
  code!: string;
  @Column({ type: 'varchar', length: 160 })
  name!: string;
  @Column({ type: 'varchar', length: 24 })
  kind!: 'ROOM' | 'EQUIPMENT';
  @Column({ type: 'smallint', default: 1 })
  capacity!: number;
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
