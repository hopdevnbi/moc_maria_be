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
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { TrainingCourse } from './entities/training-course.entity';
import { TrainingEnrollment } from './entities/training-enrollment.entity';
import {
  AssessEnrollmentDto,
  CreateTrainingCourseDto,
  EnrollProviderDto,
} from './dto/training.dto';
import { TrainingService } from './training.service';

@ApiTags('admin-training')
@ApiBearerAuth()
@Controller('admin/provider-training')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class TrainingController {
  constructor(private readonly training: TrainingService) {}

  @Get('courses')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  courses(): Promise<TrainingCourse[]> {
    return this.training.listCourses();
  }

  @Post('courses')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  createCourse(@Body() dto: CreateTrainingCourseDto): Promise<TrainingCourse> {
    return this.training.createCourse(dto);
  }

  @Post('enrollments')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  enroll(@Body() dto: EnrollProviderDto): Promise<TrainingEnrollment> {
    return this.training.enroll(dto);
  }

  @Get('applications/:id/enrollments')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  enrollments(@Param('id', new ParseUUIDPipe()) id: string): Promise<TrainingEnrollment[]> {
    return this.training.listEnrollments(id);
  }

  @Patch('enrollments/:id/assessment')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  assess(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssessEnrollmentDto,
  ): Promise<TrainingEnrollment> {
    return this.training.assess(id, actor.id, dto);
  }
}
