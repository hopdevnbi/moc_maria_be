import { PartialType } from '@nestjs/swagger';
import { SaveBranchDto } from './save-branch.dto';

export class UpdateBranchDto extends PartialType(SaveBranchDto) {}
