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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import {
  ApplyProviderDto,
  ReviewProviderDto,
  UpdateOwnApplicationDto,
} from './dto/provider-application.dto';
import { IssueCertificateDto } from './dto/certificate.dto';
import { ProviderApplication } from './entities/provider-application.entity';
import { ProviderCertificate } from './entities/provider-certificate.entity';
import { ProvidersService } from './providers.service';
import { ProviderTrustService } from './provider-trust.service';
import { SaveProviderConsentDto, VerifyProviderContactDto } from './dto/provider-trust.dto';

@ApiTags('providers')
@Controller('providers')
export class PublicProvidersController {
  constructor(private readonly service: ProvidersService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(): ReturnType<ProvidersService['publicProviders']> {
    return this.service.publicProviders();
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<ProvidersService['publicProvider']> {
    return this.service.publicProvider(id);
  }
}

@ApiTags('provider-application')
@ApiBearerAuth()
@Controller('provider-applications')
@UseGuards(AccessTokenGuard)
export class ProviderApplicationsController {
  constructor(
    private readonly service: ProvidersService,
    private readonly trust: ProviderTrustService,
  ) {}
  @Get('me/eligibility')
  @Header('Cache-Control', 'private, no-store')
  eligibility(
    @CurrentUser() actor: AuthUserContext,
  ): ReturnType<ProviderTrustService['mySummary']> {
    return this.trust.mySummary(actor.id);
  }
  @Post('me/consent')
  consent(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: SaveProviderConsentDto,
  ): ReturnType<ProviderTrustService['saveConsent']> {
    return this.trust.saveConsent(actor.id, dto);
  }
  @Post()
  apply(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: ApplyProviderDto,
  ): Promise<ProviderApplication> {
    return this.service.apply(actor.id, dto);
  }
  @Get('me')
  mine(@CurrentUser() actor: AuthUserContext): Promise<ProviderApplication | null> {
    return this.service.myApplication(actor.id);
  }
  @Patch('me')
  update(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: UpdateOwnApplicationDto,
  ): Promise<ProviderApplication> {
    return this.service.updateMyApplication(actor.id, dto);
  }

  @Get('me/training')
  @Header('Cache-Control', 'no-store')
  training(@CurrentUser() actor: AuthUserContext): ReturnType<ProvidersService['myTraining']> {
    return this.service.myTraining(actor.id);
  }
}

@ApiTags('admin-providers')
@ApiBearerAuth()
@Controller('admin/provider-applications')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class AdminProvidersController {
  constructor(
    private readonly service: ProvidersService,
    private readonly trust: ProviderTrustService,
  ) {}
  @Get(':id/eligibility')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  eligibility(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<ProviderTrustService['summary']> {
    return this.trust.summary(id, undefined, true);
  }
  @Post(':id/contact-verifications')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  verifyContact(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyProviderContactDto,
  ): ReturnType<ProviderTrustService['verifyContact']> {
    return this.trust.verifyContact(id, actor.id, dto);
  }
  @Patch(':id/contact-verifications/:verificationId/revoke')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  revokeContact(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('verificationId', new ParseUUIDPipe()) verificationId: string,
  ): ReturnType<ProviderTrustService['revokeContact']> {
    return this.trust.revokeContact(id, verificationId, actor.id);
  }
  @Get()
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  list(): Promise<ProviderApplication[]> {
    return this.service.listApplications();
  }

  @Get(':id/training')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  training(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<ProvidersService['applicationTraining']> {
    return this.service.applicationTraining(id);
  }

  @Post(':id/certificates')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  issue(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: IssueCertificateDto,
  ): Promise<ProviderCertificate> {
    return this.service.issueCertificate(id, actor.id, dto);
  }

  @Patch(':id/certificates/:certificateId/revoke')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  revoke(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('certificateId', new ParseUUIDPipe()) certificateId: string,
  ): Promise<ProviderCertificate> {
    return this.service.revokeCertificate(id, certificateId, actor.id);
  }
  @Patch(':id/review')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  review(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewProviderDto,
  ): Promise<ProviderApplication> {
    return this.service.review(id, actor.id, dto);
  }
}
