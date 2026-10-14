import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Delete,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { PERMISSIONS } from '../identity/identity.constants';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { CustomerExperienceService } from './experience.service';
import { AdminAppointmentInquiriesService } from './admin-appointment-inquiries.service';
import {
  CreateInquiryDto,
  ReplyInquiryDto,
  ReviewPresentationDto,
  SubmitPresentationDto,
  ProviderAgeDto,
  AdminInquiryQueryDto,
  AdminReplyInquiryDto,
  AdminArchiveInquiryDto,
  AdminCreateInquiryDto,
} from './experience.dto';

@Controller('provider-presentation')
export class PublicPresentationController {
  constructor(private readonly service: CustomerExperienceService) {}
  @Get('profiles') @Header('Cache-Control', 'no-store') profiles(): ReturnType<
    CustomerExperienceService['publicProfileData']
  > {
    return this.service.publicProfileData();
  }
  @Get() @Header('Cache-Control', 'no-store') public(): ReturnType<
    CustomerExperienceService['publicPresentations']
  > {
    return this.service.publicPresentations();
  }
}
@Controller()
@UseGuards(AccessTokenGuard)
export class CustomerExperienceController {
  constructor(private readonly service: CustomerExperienceService) {}
  @Get('admin/provider-public-profile/:id')
  @Header('Cache-Control', 'private, no-store')
  publicProfile(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<CustomerExperienceService['adminPublicProfile']> {
    return this.service.adminPublicProfile(actor, id);
  }
  @Patch('admin/provider-public-profile/:id') @Header('Cache-Control', 'private, no-store') age(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ProviderAgeDto,
  ): ReturnType<CustomerExperienceService['savePublicAge']> {
    return this.service.savePublicAge(actor, id, dto.age);
  }
  @Get('provider-presentation/me') @Header('Cache-Control', 'private, no-store') own(
    @CurrentUser() actor: AuthUserContext,
  ): ReturnType<CustomerExperienceService['ownPresentation']> {
    return this.service.ownPresentation(actor);
  }
  @Post('provider-presentation/me') @Header('Cache-Control', 'private, no-store') submit(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: SubmitPresentationDto,
  ): ReturnType<CustomerExperienceService['submitPresentation']> {
    return this.service.submitPresentation(actor, dto);
  }
  @Get('admin/provider-presentation') @Header('Cache-Control', 'private, no-store') pending(
    @CurrentUser() actor: AuthUserContext,
  ): ReturnType<CustomerExperienceService['pendingPresentations']> {
    return this.service.pendingPresentations(actor);
  }
  @Patch('admin/provider-presentation/:id') @Header('Cache-Control', 'private, no-store') review(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewPresentationDto,
  ): ReturnType<CustomerExperienceService['reviewPresentation']> {
    return this.service.reviewPresentation(actor, id, dto);
  }
  @Get('appointment-inquiries') @Header('Cache-Control', 'private, no-store') inquiries(
    @CurrentUser() actor: AuthUserContext,
  ): ReturnType<CustomerExperienceService['inquiries']> {
    return this.service.inquiries(actor);
  }
  @Post('appointment-inquiries') @Header('Cache-Control', 'private, no-store') create(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: CreateInquiryDto,
  ): ReturnType<CustomerExperienceService['createInquiry']> {
    return this.service.createInquiry(actor, dto);
  }
  @Patch('appointment-inquiries/:id') @Header('Cache-Control', 'private, no-store') reply(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
    @Body() dto: ReplyInquiryDto,
  ): ReturnType<CustomerExperienceService['replyInquiry']> {
    return this.service.replyInquiry(actor, id, dto);
  }
}

@ApiTags('admin-appointment-inquiries')
@ApiBearerAuth()
@Controller('admin/appointment-inquiries')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.CUSTOMER_MANAGE)
export class AdminAppointmentInquiriesController {
  constructor(private readonly service: AdminAppointmentInquiriesService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() actor: AuthUserContext,
    @Query() query: AdminInquiryQueryDto,
  ): ReturnType<AdminAppointmentInquiriesService['list']> {
    return this.service.list(actor, query);
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  create(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: AdminCreateInquiryDto,
  ): ReturnType<AdminAppointmentInquiriesService['create']> {
    return this.service.create(actor, dto);
  }

  @Delete(':id')
  @Header('Cache-Control', 'private, no-store')
  archive(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
    @Body() dto: AdminArchiveInquiryDto,
  ): ReturnType<AdminAppointmentInquiriesService['archive']> {
    return this.service.archive(actor, id, dto, true);
  }

  @Post(':id/restore')
  @Header('Cache-Control', 'private, no-store')
  restore(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
    @Body() dto: AdminArchiveInquiryDto,
  ): ReturnType<AdminAppointmentInquiriesService['archive']> {
    return this.service.archive(actor, id, dto, false);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  detail(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
  ): ReturnType<AdminAppointmentInquiriesService['detail']> {
    return this.service.detail(actor, id);
  }

  @Patch(':id')
  @Header('Cache-Control', 'private, no-store')
  update(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
    @Body() dto: AdminReplyInquiryDto,
  ): ReturnType<AdminAppointmentInquiriesService['update']> {
    return this.service.update(actor, id, dto);
  }
}
