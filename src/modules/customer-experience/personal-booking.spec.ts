import { canUsePersonalBooking } from './personal-booking';
import type { RoleName } from '../identity/identity.constants';

describe('personal service consumption without customer role grants', () => {
  it.each<RoleName>([
    'THERAPIST',
    'DOCTOR_CONSULTANT',
    'SUPER_ADMIN',
    'ADMIN',
    'BRANCH_MANAGER',
    'RECEPTIONIST',
  ])('allows active %s to use only the scoped personal booking capability', (role) => {
    expect(canUsePersonalBooking({ roles: [role], permissions: [], isActive: true })).toBe(true);
  });
  it('preserves customer permission and rejects disabled or unrecognized accounts', () => {
    expect(
      canUsePersonalBooking({
        roles: ['CUSTOMER'],
        permissions: ['customer.portal'],
        isActive: true,
      }),
    ).toBe(true);
    expect(canUsePersonalBooking({ roles: ['CUSTOMER'], permissions: [], isActive: true })).toBe(
      false,
    );
    expect(canUsePersonalBooking({ roles: ['ADMIN'], permissions: [], isActive: false })).toBe(
      false,
    );
    expect(canUsePersonalBooking({ roles: [], permissions: [], isActive: true })).toBe(false);
  });
});
