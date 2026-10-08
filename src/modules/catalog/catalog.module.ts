import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { Branch } from './entities/branch.entity';
import { BranchResource } from './entities/branch-resource.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { AdminCatalogController, PublicCatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Branch, BranchResource, ServiceCategory]),
    AuthModule,
    AccessControlModule,
  ],
  controllers: [AdminCatalogController, PublicCatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
