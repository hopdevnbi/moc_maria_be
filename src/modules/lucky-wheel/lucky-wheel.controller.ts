import { Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUserContext } from '../identity/identity.types';
import { LuckyWheelService } from './lucky-wheel.service';
import type { WheelColor } from './wheel-crypto';
export class WheelBetDto {
  @IsUUID() roundId!: string;
  @IsUUID() requestId!: string;
  @IsIn(['RED', 'BLACK', 'GREEN']) color!: WheelColor;
  @IsInt() @Min(1) @Max(100) stake!: number;
}
@Controller('games/wheel')
@UseGuards(AccessTokenGuard)
export class LuckyWheelController {
  constructor(private readonly service: LuckyWheelService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  state(@CurrentUser() user: AuthUserContext): ReturnType<LuckyWheelService['state']> {
    return this.service.state(user);
  }
  @Post('bets')
  @Header('Cache-Control', 'private, no-store')
  bet(
    @CurrentUser() user: AuthUserContext,
    @Body() input: WheelBetDto,
  ): ReturnType<LuckyWheelService['bet']> {
    return this.service.bet(user, input);
  }
}
