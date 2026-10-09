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
import { TrainingSessionsService } from './training-sessions.service';
import {
  CreateTrainingModuleDto,
  CreateTrainingSessionDto,
  MarkTrainingAttendanceDto,
  RecordTrainingSessionDto,
  RegisterTrainingSessionDto,
} from './dto/training-session.dto';

@Controller('admin/provider-training')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class AdminTrainingSessionsController {
  constructor(private readonly service: TrainingSessionsService) {}
  @Get('instructors')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  instructors(): ReturnType<TrainingSessionsService['instructors']> {
    return this.service.instructors();
  }
  @Get('courses/:id/program')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  program(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<TrainingSessionsService['program']> {
    return this.service.program(id);
  }
  @Post('courses/:id/modules')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  module(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: CreateTrainingModuleDto,
  ): ReturnType<TrainingSessionsService['createModule']> {
    return this.service.createModule(id, actor.id, dto);
  }
  @Post('courses/:id/sessions')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  session(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: CreateTrainingSessionDto,
  ): ReturnType<TrainingSessionsService['createSession']> {
    return this.service.createSession(id, actor.id, dto);
  }
  @Patch('sessions/:id/state')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  state(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: RecordTrainingSessionDto,
  ): ReturnType<TrainingSessionsService['recordSession']> {
    return this.service.recordSession(id, actor.id, dto);
  }
  @Get('enrollments/:id/sessions')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  sessions(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<TrainingSessionsService['enrollmentSessions']> {
    return this.service.enrollmentSessions(id);
  }
  @Post('enrollments/:id/sessions')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  register(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: RegisterTrainingSessionDto,
  ): ReturnType<TrainingSessionsService['register']> {
    return this.service.register(id, actor.id, dto);
  }
  @Post('enrollments/:id/sessions/:sessionId/attendance')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  attendance(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: MarkTrainingAttendanceDto,
  ): ReturnType<TrainingSessionsService['markAttendance']> {
    return this.service.markAttendance(id, sessionId, actor.id, dto);
  }
}
@Controller('provider-applications/me')
@UseGuards(AccessTokenGuard)
export class OwnTrainingSessionsController {
  constructor(private readonly service: TrainingSessionsService) {}
  @Get('training-sessions')
  @Header('Cache-Control', 'private, no-store')
  sessions(
    @CurrentUser() actor: AuthUserContext,
  ): ReturnType<TrainingSessionsService['ownSessions']> {
    return this.service.ownSessions(actor.id);
  }
}
