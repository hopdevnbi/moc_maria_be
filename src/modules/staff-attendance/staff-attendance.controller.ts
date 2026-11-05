import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { CreateStaffCheckInDto } from './dto/check-in.dto';
import { ListStaffCheckInsDto } from './dto/list-check-ins.dto';
import { StaffAttendanceService } from './staff-attendance.service';
import type { AttendanceImageFile } from './staff-attendance.storage';

@ApiTags('staff-attendance')
@ApiBearerAuth()
@Controller('staff-attendance')
@UseGuards(AccessTokenGuard)
export class StaffAttendanceController {
  constructor(private readonly service: StaffAttendanceService) {}

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  me(@CurrentUser() actor: AuthUserContext): Promise<unknown> {
    return this.service.me(actor);
  }

  @Get('me/history')
  @Header('Cache-Control', 'private, no-store')
  history(@CurrentUser() actor: AuthUserContext, @Query('limit') limit?: string): Promise<unknown> {
    return this.service.history(actor, limit);
  }

  @Post('check-ins')
  checkIn(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: CreateStaffCheckInDto,
  ): Promise<unknown> {
    return this.service.create(actor, dto);
  }

  @Post('check-ins/:id/selfie')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  selfie(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: AttendanceImageFile | undefined,
  ): Promise<unknown> {
    return this.service.uploadSelfie(actor, id, file);
  }
}

@ApiTags('admin-staff-attendance')
@ApiBearerAuth()
@Controller('admin/staff-attendance')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.STAFF_MANAGE)
export class AdminStaffAttendanceController {
  constructor(private readonly service: StaffAttendanceService) {}

  @Get('check-ins')
  @Header('Cache-Control', 'private, no-store')
  list(@Query() dto: ListStaffCheckInsDto): Promise<unknown> {
    return this.service.listAdmin(dto);
  }

  @Delete('check-ins/:id')
  @Header('Cache-Control', 'private, no-store')
  removeCheckIn(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<unknown> {
    return this.service.deleteCheckIn(actor, id);
  }

  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  summary(@Query('date') date?: string): Promise<unknown> {
    return this.service.summary(date);
  }

  @Get('branches')
  @Header('Cache-Control', 'private, no-store')
  branches(): Promise<unknown> {
    return this.service.adminBranches();
  }
}
