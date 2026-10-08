import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Branch } from '../catalog/entities/branch.entity';
import { SaveBranchDto } from './dto/save-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(@InjectRepository(Branch) private readonly branches: Repository<Branch>) {}

  listPublic(): Promise<Branch[]> {
    return this.branches.find({ where: { isActive: true }, order: { name: 'ASC' } });
  }

  listAdmin(): Promise<Branch[]> {
    return this.branches.find({ order: { createdAt: 'DESC' } });
  }

  async create(dto: SaveBranchDto): Promise<Branch> {
    const { code, name, address, ...rest } = dto;
    try {
      return await this.branches.save(
        this.branches.create({
          ...rest,
          code,
          name: name.trim(),
          address: address.trim(),
          phone: dto.phone?.trim() || null,
        }),
      );
    } catch (error) {
      this.handleUniqueViolation(error);
      throw error;
    }
  }

  async update(id: string, dto: UpdateBranchDto): Promise<Branch> {
    const branch = await this.branches.findOne({ where: { id } });
    if (!branch) throw new NotFoundException('Không tìm thấy chi nhánh.');
    const next = { ...dto };
    if (next.name !== undefined) next.name = next.name.trim();
    if (next.address !== undefined) next.address = next.address.trim();
    if (next.phone !== undefined) next.phone = next.phone?.trim() || null;
    Object.assign(branch, next);
    try {
      return await this.branches.save(branch);
    } catch (error) {
      this.handleUniqueViolation(error);
      throw error;
    }
  }

  private handleUniqueViolation(error: unknown): void {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new ConflictException('Mã chi nhánh đã được sử dụng.');
    }
  }
}
