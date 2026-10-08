import { SetMetadata } from '@nestjs/common';
import type { RoleName } from '../../identity/identity.constants';

export const REQUIRED_ROLES_KEY = 'moc_maria_required_roles';

export const RequireRoles = (...roles: RoleName[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);
