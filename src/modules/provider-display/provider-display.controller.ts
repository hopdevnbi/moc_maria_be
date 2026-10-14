import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { ProviderDisplayService } from './provider-display.service';
import { ReorderProviderDisplayDto, UpdateProviderDisplayDto } from './provider-display.dto';

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
  constructor(private readonly display: ProviderDisplayService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() actor: AuthUserContext): ReturnType<ProviderDisplayService['list']> {
    return this.display.list(actor);
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
