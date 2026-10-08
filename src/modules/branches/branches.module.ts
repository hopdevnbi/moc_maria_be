import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { Branch } from '../catalog/entities/branch.entity';
import { AdminBranchesController, PublicBranchesController } from './branches.controller';
import { BranchesService } from './branches.service';

@Module({
  imports: [TypeOrmModule.forFeature([Branch]), AuthModule, AccessControlModule],
  controllers: [AdminBranchesController, PublicBranchesController],
  providers: [BranchesService],
})
export class BranchesModule {}
