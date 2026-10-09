import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { ProviderScheduleService } from './provider-schedule.service';
import {
  AddProviderDateScheduleDto,
  AddProviderWeeklyShiftDto,
  AssignProviderBranchDto,
  AssignProviderSkillDto,
  ProviderOperationReasonDto,
} from './dto/provider-schedule.dto';

@Controller('provider-applications/me')
@UseGuards(AccessTokenGuard)
export class OwnProviderScheduleController {
  constructor(private readonly service: ProviderScheduleService) {}
  @Get('planning')
  @Header('Cache-Control', 'private, no-store')
  planning(
    @CurrentUser() actor: AuthUserContext,
  ): ReturnType<ProviderScheduleService['myPlanning']> {
    return this.service.myPlanning(actor.id);
  }
}

@Controller('admin/provider-applications/:id')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class AdminProviderScheduleController {
  constructor(private readonly service: ProviderScheduleService) {}
  @Get('planning')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  planning(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<ProviderScheduleService['planning']> {
    return this.service.planning(id);
  }
  @Get('planning/windows')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  windows(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('branchId', new ParseUUIDPipe()) branchId: string,
    @Query('date') date: string,
  ): ReturnType<ProviderScheduleService['windows']> {
    return this.service.windows(id, branchId, date);
  }
  @Post('skills')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  skill(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: AssignProviderSkillDto,
  ): ReturnType<ProviderScheduleService['assignSkill']> {
    return this.service.assignSkill(id, actor.id, dto);
  }
  @Post('branch-assignments')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  branch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: AssignProviderBranchDto,
  ): ReturnType<ProviderScheduleService['assignBranch']> {
    return this.service.assignBranch(id, actor.id, dto);
  }
  @Post('weekly-shifts')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  weekly(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: AddProviderWeeklyShiftDto,
  ): ReturnType<ProviderScheduleService['addWeeklyShift']> {
    return this.service.addWeeklyShift(id, actor.id, dto);
  }
  @Post('dated-schedules')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  dated(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: AddProviderDateScheduleDto,
  ): ReturnType<ProviderScheduleService['addDateSchedule']> {
    return this.service.addDateSchedule(id, actor.id, dto);
  }
  @Patch('weekly-shifts/:recordId/disable')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  disableWeekly(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('recordId', new ParseUUIDPipe()) recordId: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: ProviderOperationReasonDto,
  ): ReturnType<ProviderScheduleService['disableShift']> {
    return this.service.disableShift(id, recordId, actor.id, dto, false);
  }
  @Patch('dated-schedules/:recordId/disable')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  disableDate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('recordId', new ParseUUIDPipe()) recordId: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: ProviderOperationReasonDto,
  ): ReturnType<ProviderScheduleService['disableShift']> {
    return this.service.disableShift(id, recordId, actor.id, dto, true);
  }
}
