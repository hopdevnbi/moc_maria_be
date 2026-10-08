import type { RoleName } from './identity.constants';

export interface AuthUserContext {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  sessionId: string;
  roles: RoleName[];
  permissions: string[];
}
