import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { ProviderShowcaseService } from './provider-showcase.service';
import type { KtvShowcase } from './provider-showcase.service';
import { UpdateShowcaseDto } from './provider-showcase.dto';
import type { ShowcaseMediaDto } from './provider-showcase.dto';

@ApiTags('provider-showcase')
@Controller('provider-showcase')
export class ProviderShowcaseController {
  constructor(private readonly showcase: ProviderShowcaseService) {}

  @Get(':id')
  @Header('Cache-Control', 'public, no-store')
  public(@Param('id', new ParseUUIDPipe()) id: string): Promise<KtvShowcase> {
    return this.showcase.publicDetail(id);
  }

  @Get(':id/editor')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'private, no-store')
  editor(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<KtvShowcase> {
    return this.showcase.editor(actor, id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'private, no-store')
  update(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateShowcaseDto,
  ): Promise<KtvShowcase> {
    return this.showcase.update(actor, id, dto);
  }

  @Post(':id/media')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 40 * 1024 * 1024 } }))
  upload(
    @CurrentUser() actor: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined,
    @Body('consentVersion') consentVersion?: string,
  ): Promise<ShowcaseMediaDto> {
    return this.showcase.upload(actor, id, file, consentVersion);
  }
}
