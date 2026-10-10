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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvSafetyService } from './safety.service';
import { SafetyActionDto, SafetyIncidentDto, SafetyPointDto, StartSafetyDto } from './safety.dto';
@Controller('ktv-safety')
@UseGuards(AccessTokenGuard)
export class KtvSafetyController {
  constructor(private readonly service: KtvSafetyService) {}
  @Get('me') @Header('Cache-Control', 'private, no-store') own(
    @CurrentUser() a: AuthUserContext,
  ): Promise<unknown> {
    return this.service.own(a);
  }
  @Get('monitor') @Header('Cache-Control', 'private, no-store') monitor(
    @CurrentUser() a: AuthUserContext,
  ): Promise<unknown> {
    return this.service.monitor(a);
  }
  @Post() @Header('Cache-Control', 'private, no-store') start(
    @CurrentUser() a: AuthUserContext,
    @Body() d: StartSafetyDto,
  ): Promise<unknown> {
    return this.service.start(a, d);
  }
  @Post(':id/point') @Header('Cache-Control', 'private, no-store') point(
    @CurrentUser() a: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() d: SafetyPointDto,
  ): Promise<unknown> {
    return this.service.point(a, id, d);
  }
  @Post(':id/action') @Header('Cache-Control', 'private, no-store') action(
    @CurrentUser() a: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() d: SafetyActionDto,
  ): Promise<unknown> {
    return this.service.action(a, id, d);
  }
  @Post(':id/incident') @Header('Cache-Control', 'private, no-store') incident(
    @CurrentUser() a: AuthUserContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() d: SafetyIncidentDto,
  ): Promise<unknown> {
    return this.service.incident(a, id, d);
  }
}
