import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PERMISSIONS } from '../identity/identity.constants';
import { CatalogService } from './catalog.service';
import { BranchResource } from './entities/branch-resource.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { SaveCategoryDto } from './dto/save-category.dto';
import { SaveResourceDto } from './dto/save-resource.dto';
import { PartialType } from '@nestjs/swagger';

class UpdateCategoryDto extends PartialType(SaveCategoryDto) {}
class UpdateResourceDto extends PartialType(SaveResourceDto) {}

@ApiTags('catalog')
@Controller()
export class PublicCatalogController {
  constructor(private readonly service: CatalogService) {}
  @Get('service-categories')
  categories(): Promise<ServiceCategory[]> {
    return this.service.publicCategories();
  }
  @Get('branches/:id/resources')
  resources(@Param('id', new ParseUUIDPipe()) id: string): Promise<BranchResource[]> {
    return this.service.branchResources(id);
  }
}

@ApiTags('admin-catalog')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class AdminCatalogController {
  constructor(private readonly service: CatalogService) {}
  @Get('service-categories')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  categories(): Promise<ServiceCategory[]> {
    return this.service.adminCategories();
  }
  @Post('service-categories')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  addCategory(@Body() dto: SaveCategoryDto): Promise<ServiceCategory> {
    return this.service.saveCategory(dto);
  }
  @Patch('service-categories/:id')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<ServiceCategory> {
    return this.service.updateCategory(id, dto);
  }
  @Get('branches/:branchId/resources')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  resources(@Param('branchId', new ParseUUIDPipe()) branchId: string): Promise<BranchResource[]> {
    return this.service.branchResources(branchId, true);
  }
  @Post('branches/:branchId/resources')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  addResource(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() dto: SaveResourceDto,
  ): Promise<BranchResource> {
    return this.service.createResource(branchId, dto);
  }
  @Patch('branches/:branchId/resources/:id')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  updateResource(
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateResourceDto,
  ): Promise<BranchResource> {
    return this.service.updateResource(branchId, id, dto);
  }
}
