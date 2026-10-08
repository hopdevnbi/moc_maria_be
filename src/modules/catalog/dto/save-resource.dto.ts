import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class SaveResourceDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @Length(2, 40)
  code!: string;
  @IsString()
  @Length(2, 160)
  name!: string;
  @IsIn(['ROOM', 'EQUIPMENT'])
  kind!: 'ROOM' | 'EQUIPMENT';
  @IsInt()
  @Min(1)
  @Max(100)
  capacity!: number;
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
