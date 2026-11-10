import type { AuthUserContext } from '../identity/identity.types';

// A staff account may consume a service under its own identity. This grants no
// customer-management access or role, and never bypasses participant checks.
export function canUsePersonalBooking(
  actor: Pick<AuthUserContext, 'permissions' | 'roles' | 'isActive'>,
): boolean {
  return (
    actor.isActive !== false &&
    (actor.permissions.includes('customer.portal') ||
      !!actor.roles?.some((role) =>
        [
          'THERAPIST',
          'DOCTOR_CONSULTANT',
          'SUPER_ADMIN',
          'ADMIN',
          'BRANCH_MANAGER',
          'RECEPTIONIST',
        ].includes(role),
      ))
  );
}
