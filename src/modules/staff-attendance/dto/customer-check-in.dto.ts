import { IsUUID } from 'class-validator';
import { CreateStaffCheckInDto } from './check-in.dto';

export class CreateCustomerCheckInDto extends CreateStaffCheckInDto {
  /** Browser-scoped, randomly generated, persistent installation identifier. */
  @IsUUID('4')
  deviceId!: string;
}
