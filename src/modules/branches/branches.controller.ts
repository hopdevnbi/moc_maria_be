import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { PERMISSIONS } from '../identity/identity.constants';
import { Branch } from '../catalog/entities/branch.entity';
import { BranchBusinessHour } from '../catalog/entities/branch-business-hour.entity';
import { BranchExceptionHour } from '../catalog/entities/branch-exception-hour.entity';
import { BranchesService } from './branches.service';
import { SaveBranchDto } from './dto/save-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { ReplaceBusinessHoursDto } from './dto/replace-business-hours.dto';
import { SaveExceptionHourDto } from './dto/save-exception-hour.dto';

@ApiTags('branches')
@Controller('branches')
export class PublicBranchesController {
  constructor(private readonly service: BranchesService) {}
  @Get()
  list(): Promise<Branch[]> {
    return this.service.listPublic();
  }

  @Get(':id/hours')
  hours(@Param('id', new ParseUUIDPipe()) id: string): Promise<BranchBusinessHour[]> {
    return this.service.listHours(id);
  }

  @Get(':id/exceptions')
  exceptions(@Param('id', new ParseUUIDPipe()) id: string): Promise<BranchExceptionHour[]> {
    return this.service.listExceptions(id);
  }
}

@ApiTags('admin-branches')
@ApiBearerAuth()
@Controller('admin/branches')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class AdminBranchesController {
  constructor(private readonly service: BranchesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  list(): Promise<Branch[]> {
    return this.service.listAdmin();
  }

  @Post()
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  create(@Body() dto: SaveBranchDto): Promise<Branch> {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBranchDto,
  ): Promise<Branch> {
    return this.service.update(id, dto);
  }

  @Put(':id/hours')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  replaceHours(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReplaceBusinessHoursDto,
  ): Promise<BranchBusinessHour[]> {
    return this.service.replaceHours(id, dto);
  }

  @Put(':id/exceptions')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  saveException(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SaveExceptionHourDto,
  ): Promise<BranchExceptionHour> {
    return this.service.saveException(id, dto);
  }
}
