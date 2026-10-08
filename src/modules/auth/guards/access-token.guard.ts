import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest, AccessTokenPayload } from '../auth.types';
import { IdentityService } from '../../identity/identity.service';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly identityService: IdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Bearer access token is required.');
    }

    const token = header.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Bearer access token is required.');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired.');
    }

    if (!payload.sub || !payload.sid) {
      throw new UnauthorizedException('Access token payload is invalid.');
    }

    request.authUser = await this.identityService.resolveAuthContext(payload.sub, payload.sid);
    return true;
  }
}
