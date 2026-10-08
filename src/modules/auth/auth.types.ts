import type { Request } from 'express';
import type { AuthUserContext } from '../identity/identity.types';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUserContext;
}

export interface AuthResult {
  accessToken: string;
  user: AuthUserContext;
}
