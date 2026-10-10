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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { RequirePermissions } from '../access-control/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../identity/identity.constants';
import type { AuthUserContext } from '../identity/identity.types';
import { ProviderReviewsService } from './provider-reviews.service';
import {
  CreateProviderReviewDto,
  EditProviderReviewDto,
  EligibleProviderReviewDto,
  ModerateProviderReviewDto,
  ProviderReviewPageDto,
  AdminProviderReviewPageDto,
} from './provider-reviews.dto';
@ApiTags('provider-reviews')
@Controller('providers')
export class PublicProviderReviewsController {
  constructor(private readonly reviews: ProviderReviewsService) {}
  @Get(':id/reviews')
  @Header('Cache-Control', 'no-store')
  list(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() dto: ProviderReviewPageDto,
  ): ReturnType<ProviderReviewsService['publicReviews']> {
    return this.reviews.publicReviews(id, dto.page);
  }
}
@ApiTags('provider-reviews')
@Controller('provider-reviews/public')
export class PublicProviderRatingsController {
  constructor(private readonly reviews: ProviderReviewsService) {}
  @Get('ratings')
  @Header('Cache-Control', 'no-store')
  ratings(): ReturnType<ProviderReviewsService['ratingSummaries']> {
    return this.reviews.ratingSummaries();
  }
}
@ApiTags('provider-reviews')
@ApiBearerAuth()
@Controller('provider-reviews')
@UseGuards(AccessTokenGuard)
export class OwnProviderReviewsController {
  constructor(private readonly reviews: ProviderReviewsService) {}
  @Get('me/eligible')
  @Header('Cache-Control', 'private, no-store')
  eligible(
    @CurrentUser() actor: AuthUserContext,
    @Query() dto: EligibleProviderReviewDto,
  ): ReturnType<ProviderReviewsService['eligible']> {
    return this.reviews.eligible(actor, dto.providerApplicationId);
  }
  @Post()
  @Header('Cache-Control', 'private, no-store')
  create(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: CreateProviderReviewDto,
  ): ReturnType<ProviderReviewsService['create']> {
    return this.reviews.create(actor, dto);
  }
  @Patch(':id')
  @Header('Cache-Control', 'private, no-store')
  edit(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EditProviderReviewDto,
  ): ReturnType<ProviderReviewsService['edit']> {
    return this.reviews.edit(actor, id, dto);
  }
}
@ApiTags('admin-provider-reviews')
@ApiBearerAuth()
@Controller('admin/provider-reviews')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class AdminProviderReviewsController {
  constructor(private readonly reviews: ProviderReviewsService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  list(
    @Query() dto: AdminProviderReviewPageDto,
  ): ReturnType<ProviderReviewsService['adminReviews']> {
    return this.reviews.adminReviews(dto);
  }

  @Patch(':id/visibility')
  @RequirePermissions(PERMISSIONS.STAFF_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  moderate(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ModerateProviderReviewDto,
  ): ReturnType<ProviderReviewsService['moderate']> {
    return this.reviews.moderate(actor, id, dto);
  }
}
