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
import { CreateServiceDto, CreateVariantDto, SetBranchServiceDto } from './dto/service-catalog.dto';
import { Service } from './entities/service.entity';
import { ServiceVariant } from './entities/service-variant.entity';
import { BranchService } from './entities/branch-service.entity';

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

  @Get('services')
  services(): Promise<Array<{ service: Service; variants: ServiceVariant[] }>> {
    return this.service.publicServices();
  }

  @Get('branches/:id/services')
  branchServices(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<CatalogService['publicBranchServices']> {
    return this.service.publicBranchServices(id);
  }
}

@ApiTags('admin-catalog')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class AdminCatalogController {
  constructor(private readonly service: CatalogService) {}

  @Get('services')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  services(): Promise<Service[]> {
    return this.service.adminServices();
  }

  @Post('services')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  createService(@Body() dto: CreateServiceDto): Promise<Service> {
    return this.service.addService(dto);
  }

  @Post('services/:id/variants')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  createVariant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateVariantDto,
  ): Promise<ServiceVariant> {
    return this.service.addVariant(id, dto);
  }

  @Post('branches/:id/services')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  setBranchService(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetBranchServiceDto,
  ): Promise<BranchService> {
    return this.service.setBranchService(id, dto);
  }
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
