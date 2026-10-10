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
import type { AuthUserContext } from '../identity/identity.types';
import { CustomerExperienceService } from './experience.service';
import {
  CreateInquiryDto,
  ReplyInquiryDto,
  ReviewPresentationDto,
  SubmitPresentationDto,
} from './experience.dto';

@Controller('provider-presentation')
export class PublicPresentationController {
  constructor(private readonly service: CustomerExperienceService) {}
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
