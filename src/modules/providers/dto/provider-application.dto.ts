import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PROVIDER_APPLICATION_STATUSES } from '../entities/provider-application.entity';
import type { ProviderApplicationStatus } from '../entities/provider-application.entity';

export class ApplyProviderDto {
  @IsString()
  @Length(2, 160)
  publicName!: string;
  @IsOptional()
  @IsString()
  @Length(1, 500)
  introduction?: string;
  @IsOptional()
  @IsString()
  @Length(1, 160)
  serviceArea?: string;
}

export class ReviewProviderDto {
  @IsIn([...PROVIDER_APPLICATION_STATUSES])
  status!: ProviderApplicationStatus;
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}
