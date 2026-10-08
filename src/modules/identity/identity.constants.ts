export const ROLE_NAMES = [
  'SUPER_ADMIN',
  'ADMIN',
  'BRANCH_MANAGER',
  'RECEPTIONIST',
  'THERAPIST',
  'DOCTOR_CONSULTANT',
  'CUSTOMER',
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export const PERMISSIONS = {
  ADMIN_PORTAL: 'admin.portal',
  USER_MANAGE: 'users.manage',
  ROLE_MANAGE: 'roles.manage',
  STAFF_MANAGE: 'staff.manage',
  CUSTOMER_MANAGE: 'customers.manage',
  STAFF_PORTAL: 'staff.portal',
  CUSTOMER_PORTAL: 'customer.portal',
  PROFILE_SELF: 'profile.self',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
