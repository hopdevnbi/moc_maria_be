import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BranchBusinessHour } from '../catalog/entities/branch-business-hour.entity';
import { BranchExceptionHour } from '../catalog/entities/branch-exception-hour.entity';
import { Branch } from '../catalog/entities/branch.entity';
import { ReplaceBusinessHoursDto } from './dto/replace-business-hours.dto';
import { SaveExceptionHourDto } from './dto/save-exception-hour.dto';
import { SaveBranchDto } from './dto/save-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    @InjectRepository(BranchBusinessHour) private readonly hours: Repository<BranchBusinessHour>,
    @InjectRepository(BranchExceptionHour)
    private readonly exceptions: Repository<BranchExceptionHour>,
    private readonly dataSource: DataSource,
  ) {}

  async listExceptions(id: string, admin = false): Promise<BranchExceptionHour[]> {
    const branch = await this.branches.findOne({ where: admin ? { id } : { id, isActive: true } });
    if (!branch) throw new NotFoundException('Không tìm thấy chi nhánh.');
    return this.exceptions.find({ where: { branchId: id }, order: { date: 'ASC' } });
  }

  async saveException(id: string, dto: SaveExceptionHourDto): Promise<BranchExceptionHour> {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dto.date) ||
      (dto.isClosed && (dto.opensAtMinute != null || dto.closesAtMinute != null)) ||
      (!dto.isClosed &&
        (dto.opensAtMinute == null ||
          dto.closesAtMinute == null ||
          dto.opensAtMinute >= dto.closesAtMinute))
    ) {
      throw new BadRequestException('Ngày hoặc thời gian ngoại lệ không hợp lệ.');
    }
    return this.dataSource.transaction(async (manager) => {
      const branch = await manager.findOne(Branch, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!branch) throw new NotFoundException('Không tìm thấy chi nhánh.');
      const existing = await manager.findOneBy(BranchExceptionHour, {
        branchId: id,
        date: dto.date,
      });
      return manager.save(BranchExceptionHour, {
        ...existing,
        branchId: id,
        date: dto.date,
        isClosed: dto.isClosed,
        opensAtMinute: dto.isClosed ? null : dto.opensAtMinute,
        closesAtMinute: dto.isClosed ? null : dto.closesAtMinute,
        note: dto.note?.trim() || null,
      });
    });
  }

  async listHours(id: string, admin = false): Promise<BranchBusinessHour[]> {
    const branch = await this.branches.findOne({ where: admin ? { id } : { id, isActive: true } });
    if (!branch) throw new NotFoundException('Không tìm thấy chi nhánh.');
    return this.hours.find({ where: { branchId: id }, order: { weekday: 'ASC' } });
  }

  async replaceHours(id: string, dto: ReplaceBusinessHoursDto): Promise<BranchBusinessHour[]> {
    const days = dto.hours.map((hour) => hour.weekday);
    if (
      new Set(days).size !== days.length ||
      dto.hours.some((hour) => hour.closesAtMinute <= hour.opensAtMinute)
    ) {
      throw new BadRequestException('Lịch mở cửa không hợp lệ hoặc trùng thứ trong tuần.');
    }
    await this.dataSource.transaction(async (manager) => {
      const branch = await manager
        .getRepository(Branch)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!branch) throw new NotFoundException('Không tìm thấy chi nhánh.');
      const repo = manager.getRepository(BranchBusinessHour);
      await repo.delete({ branchId: id });
      if (dto.hours.length) {
        await repo.save(dto.hours.map((hour) => repo.create({ ...hour, branchId: id })));
      }
    });
    return this.hours.find({ where: { branchId: id }, order: { weekday: 'ASC' } });
  }

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
