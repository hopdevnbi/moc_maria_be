import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { DetailedTrainingService } from './detailed-training.service';
import {
  DetailedAssessmentDto,
  ModuleRequirementDto,
  TrainingCriterionDto,
} from './dto/training-assessment.dto';
@Controller('admin/provider-training')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class DetailedTrainingController {
  constructor(private readonly service: DetailedTrainingService) {}
  @Get('courses/:id/requirements')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  requirements(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<DetailedTrainingService['requirements']> {
    return this.service.requirements(id);
  }
  @Patch('courses/:id/modules/:moduleId/requirements')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  module(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('moduleId', new ParseUUIDPipe()) moduleId: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: ModuleRequirementDto,
  ): ReturnType<DetailedTrainingService['moduleRequirements']> {
    return this.service.moduleRequirements(id, moduleId, actor.id, dto);
  }
  @Post('courses/:id/criteria')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  create(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: TrainingCriterionDto,
  ): ReturnType<DetailedTrainingService['criterion']> {
    return this.service.criterion(id, null, actor.id, dto);
  }
  @Patch('courses/:id/criteria/:criterionId')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('criterionId', new ParseUUIDPipe()) criterionId: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: TrainingCriterionDto,
  ): ReturnType<DetailedTrainingService['criterion']> {
    return this.service.criterion(id, criterionId, actor.id, dto);
  }
  @Get('enrollments/:id/assessments')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  view(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<DetailedTrainingService['assessmentView']> {
    return this.service.assessmentView(id);
  }
  @Post('enrollments/:id/assessments')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  assess(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: DetailedAssessmentDto,
  ): ReturnType<DetailedTrainingService['assessment']> {
    return this.service.assessment(id, actor.id, dto);
  }
}
