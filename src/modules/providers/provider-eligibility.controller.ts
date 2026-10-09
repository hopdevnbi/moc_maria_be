import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { ProviderEligibilityService } from './provider-eligibility.service';
import {
  SaveProviderOperatingReviewDto,
  SaveProviderPublicProfileDto,
  SaveProviderServiceGrantDto,
  SaveServiceProviderPolicyDto,
} from './dto/provider-eligibility.dto';

@Controller('provider-applications/me')
@UseGuards(AccessTokenGuard)
export class OwnProviderEligibilityController {
  constructor(private readonly service: ProviderEligibilityService) {}
  @Get('service-readiness')
  @Header('Cache-Control', 'private, no-store')
  readiness(
    @CurrentUser() actor: AuthUserContext,
  ): ReturnType<ProviderEligibilityService['mySummary']> {
    return this.service.mySummary(actor.id);
  }
}

@Controller('admin')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class AdminProviderEligibilityController {
  constructor(private readonly service: ProviderEligibilityService) {}
  @Get('service-provider-policies')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  policies(): ReturnType<ProviderEligibilityService['policies']> {
    return this.service.policies();
  }
  @Post('service-provider-policies')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  policy(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: SaveServiceProviderPolicyDto,
  ): ReturnType<ProviderEligibilityService['savePolicy']> {
    return this.service.savePolicy(actor.id, dto);
  }
  @Get('provider-applications/:id/service-readiness')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  readiness(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<ProviderEligibilityService['summary']> {
    return this.service.summary(id);
  }
  @Post('provider-applications/:id/public-profile')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  profile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: SaveProviderPublicProfileDto,
  ): ReturnType<ProviderEligibilityService['savePublicProfile']> {
    return this.service.savePublicProfile(id, actor.id, dto);
  }
  @Get('provider-applications/:id/service-configuration')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  configuration(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): ReturnType<ProviderEligibilityService['configuration']> {
    return this.service.configuration(id);
  }
  @Post('provider-applications/:id/operating-review')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  operating(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: SaveProviderOperatingReviewDto,
  ): ReturnType<ProviderEligibilityService['saveOperatingReview']> {
    return this.service.saveOperatingReview(id, actor.id, dto);
  }
  @Post('provider-applications/:id/service-grants')
  @RequirePermissions(PERMISSIONS.ROLE_MANAGE)
  grant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: SaveProviderServiceGrantDto,
  ): ReturnType<ProviderEligibilityService['saveGrant']> {
    return this.service.saveGrant(id, actor.id, dto);
  }
}
