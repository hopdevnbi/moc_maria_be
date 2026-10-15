import { Body, Controller, Header, Param, Post, UseGuards } from '@nestjs/common';
import { Equals, IsBoolean, IsString, Length } from 'class-validator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { ProviderWorkspaceService } from './provider-workspace.service';
export class CompleteProviderInquiryDto {
  @IsBoolean() @Equals(true) servicePerformedConfirmed!: boolean;
  @IsString() @Length(10, 500) reason!: string;
}
export class StartProviderInquiryDto {
  @IsString() @Length(10, 500) reason!: string;
}
@Controller('provider/appointment-inquiries')
@UseGuards(AccessTokenGuard)
export class ProviderWorkspaceController {
  constructor(private readonly service: ProviderWorkspaceService) {}
  @Post(':id/start') @Header('Cache-Control', 'private, no-store') start(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
    @Body() dto: StartProviderInquiryDto,
  ): ReturnType<ProviderWorkspaceService['start']> {
    return this.service.start(actor, id, dto);
  }
  @Post(':id/complete') @Header('Cache-Control', 'private, no-store') complete(
    @CurrentUser() actor: AuthUserContext,
    @Param('id') id: string,
    @Body() dto: CompleteProviderInquiryDto,
  ): ReturnType<ProviderWorkspaceService['complete']> {
    return this.service.complete(actor, id, dto);
  }
}
