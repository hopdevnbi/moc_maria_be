import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { ProviderDisplayService } from './provider-display.service';
import { ReorderProviderDisplayDto, UpdateProviderDisplayDto } from './provider-display.dto';
import { CreateKtvDto } from './create-ktv.dto';
import { KtvOnboardingService, type CreatedKtv } from './ktv-onboarding.service';
import { KtvAccountAdminService, type KtvAccountAdminView } from './ktv-account-admin.service';
import { UpdateKtvAccountDto } from './update-ktv-account.dto';

@Controller('provider-display')
export class PublicProviderDisplayController {
  constructor(private readonly display: ProviderDisplayService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  publicDisplay(): ReturnType<ProviderDisplayService['publicDisplay']> {
    return this.display.publicDisplay();
  }
}

@Controller('admin/provider-display')
@UseGuards(AccessTokenGuard)
export class AdminProviderDisplayController {
  constructor(
    private readonly display: ProviderDisplayService,
    private readonly onboarding: KtvOnboardingService,
    private readonly account: KtvAccountAdminService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthUserContext): ReturnType<ProviderDisplayService['list']> {
    return this.display.list(actor);
  }
  @Get('ktv/capabilities')
  @Header('Cache-Control', 'private, no-store')
  ktvCapabilities(@CurrentUser() actor: AuthUserContext): { createKtv: boolean } {
    return {
      createKtv: actor.roles.includes('SUPER_ADMIN') && actor.permissions.includes('staff.manage'),
    };
  }
  @Post('ktv')
  @Header('Cache-Control', 'private, no-store')
  createKtv(@CurrentUser() actor: AuthUserContext, @Body() dto: CreateKtvDto): Promise<CreatedKtv> {
    return this.onboarding.create(actor, dto);
  }
  @Get('ktv/:id/account')
  @Header('Cache-Control', 'private, no-store')
  accountInfo(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<KtvAccountAdminView> {
    return this.account.get(actor, id);
  }
  @Patch('ktv/:id/account')
  @Header('Cache-Control', 'private, no-store')
  updateKtvAccount(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKtvAccountDto,
  ): Promise<KtvAccountAdminView> {
    return this.account.update(actor, id, dto);
  }
  @Patch(':id/avatar')
  @Header('Cache-Control', 'private, no-store')
  setAvatar(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('mediaId') mediaId: string,
  ): ReturnType<ProviderDisplayService['setAvatarFromShowcase']> {
    return this.display.setAvatarFromShowcase(actor, id, mediaId);
  }
  @Put('order')
  @Header('Cache-Control', 'private, no-store')
  reorder(
    @CurrentUser() actor: AuthUserContext,
    @Body() dto: ReorderProviderDisplayDto,
  ): ReturnType<ProviderDisplayService['reorder']> {
    return this.display.reorder(actor, dto);
  }
  @Patch(':id')
  @Header('Cache-Control', 'private, no-store')
  update(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProviderDisplayDto,
  ): ReturnType<ProviderDisplayService['update']> {
    return this.display.update(actor, id, dto);
  }
}
