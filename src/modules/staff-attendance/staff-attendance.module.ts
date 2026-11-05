import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { Branch } from '../catalog/entities/branch.entity';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { StaffCheckIn } from './entities/staff-check-in.entity';
import { StaffCoinLedger } from './entities/staff-coin-ledger.entity';
import { StaffCoinWallet } from './entities/staff-coin-wallet.entity';
import {
  AdminStaffAttendanceController,
  CustomerAttendanceController,
  StaffAttendanceController,
} from './staff-attendance.controller';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffAttendanceStorage } from './staff-attendance.storage';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StaffCheckIn,
      StaffCoinWallet,
      StaffCoinLedger,
      Branch,
      StaffProfile,
      AuditLog,
    ]),
    AuthModule,
    AccessControlModule,
  ],
  controllers: [
    StaffAttendanceController,
    CustomerAttendanceController,
    AdminStaffAttendanceController,
  ],
  providers: [StaffAttendanceService, StaffAttendanceStorage],
})
export class StaffAttendanceModule {}
