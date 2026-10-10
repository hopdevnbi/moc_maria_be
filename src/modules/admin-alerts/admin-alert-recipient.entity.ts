import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('admin_alert_recipients')
export class AdminAlertRecipient {
  @PrimaryColumn({ type: 'varchar', length: 320 }) email!: string;
  @Column({ type: 'boolean', default: true }) enabled!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
