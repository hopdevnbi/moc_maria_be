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
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { ApplyProviderDto, ReviewProviderDto } from './dto/provider-application.dto';
import { IssueCertificateDto } from './dto/certificate.dto';
import { ProviderApplication } from './entities/provider-application.entity';
import { ProviderCertificate } from './entities/provider-certificate.entity';
import { ProvidersService } from './providers.service';

@ApiTags('providers')
@Controller('providers')
export class PublicProvidersController {
  constructor(private readonly service: ProvidersService) {}
  @Get()
  list(): ReturnType<ProvidersService['publicProviders']> {
    return this.service.publicProviders();
  }
}

@ApiTags('provider-application')
@ApiBearerAuth()
@Controller('provider-applications')
@UseGuards(AccessTokenGuard)
export class ProviderApplicationsController {
  constructor(private readonly service: ProvidersService) {}
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
}

@ApiTags('admin-providers')
@ApiBearerAuth()
@Controller('admin/provider-applications')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class AdminProvidersController {
  constructor(private readonly service: ProvidersService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  list(): Promise<ProviderApplication[]> {
    return this.service.listApplications();
  }

  @Post(':id/certificates')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  issue(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: IssueCertificateDto,
  ): Promise<ProviderCertificate> {
    return this.service.issueCertificate(id, actor.id, dto);
  }

  @Patch(':id/certificates/:certificateId/revoke')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('certificateId', new ParseUUIDPipe()) certificateId: string,
  ): Promise<ProviderCertificate> {
    return this.service.revokeCertificate(id, certificateId);
  }
  @Patch(':id/review')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  review(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewProviderDto,
  ): Promise<ProviderApplication> {
    return this.service.review(id, actor.id, dto);
  }
}
