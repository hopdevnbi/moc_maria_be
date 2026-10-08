import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn } from 'class-validator';
import type { RoleName } from '../../identity/identity.constants';

const ASSIGNABLE_ROLES = [
  'ADMIN',
  'BRANCH_MANAGER',
  'RECEPTIONIST',
  'THERAPIST',
  'DOCTOR_CONSULTANT',
] as const satisfies readonly RoleName[];

export class AssignRolesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsIn(ASSIGNABLE_ROLES, { each: true })
  roles!: Array<(typeof ASSIGNABLE_ROLES)[number]>;
}
