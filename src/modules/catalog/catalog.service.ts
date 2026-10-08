import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Branch } from './entities/branch.entity';
import { BranchResource } from './entities/branch-resource.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { SaveCategoryDto } from './dto/save-category.dto';
import { SaveResourceDto } from './dto/save-resource.dto';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    @InjectRepository(BranchResource) private readonly resources: Repository<BranchResource>,
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
  ) {}

  publicCategories(): Promise<ServiceCategory[]> {
    return this.categories.find({
      where: { isPublished: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }
  adminCategories(): Promise<ServiceCategory[]> {
    return this.categories.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
  }
  async saveCategory(dto: SaveCategoryDto): Promise<ServiceCategory> {
    try {
      return await this.categories.save(this.categories.create({ ...dto, name: dto.name.trim() }));
    } catch (err) {
      this.checkConflict(err);
      throw err;
    }
  }
  async updateCategory(id: string, dto: Partial<SaveCategoryDto>): Promise<ServiceCategory> {
    const item = await this.categories.findOneBy({ id });
    if (!item) throw new NotFoundException('Category not found');
    try {
      return await this.categories.save(Object.assign(item, dto));
    } catch (err) {
      this.checkConflict(err);
      throw err;
    }
  }
  async branchResources(branchId: string, admin = false): Promise<BranchResource[]> {
    const branch = await this.branches.findOneBy(
      admin ? { id: branchId } : { id: branchId, isActive: true },
    );
    if (!branch) throw new NotFoundException('Branch not found');
    return this.resources.find({
      where: admin ? { branchId } : { branchId, isActive: true },
      order: { name: 'ASC' },
    });
  }
  async createResource(branchId: string, dto: SaveResourceDto): Promise<BranchResource> {
    const branch = await this.branches.findOneBy({ id: branchId });
    if (!branch) throw new NotFoundException('Branch not found');
    try {
      return await this.resources.save(
        this.resources.create({ ...dto, branchId, name: dto.name.trim() }),
      );
    } catch (err) {
      this.checkConflict(err);
      throw err;
    }
  }
  async updateResource(
    branchId: string,
    id: string,
    dto: Partial<SaveResourceDto>,
  ): Promise<BranchResource> {
    const item = await this.resources.findOneBy({ id, branchId });
    if (!item) throw new NotFoundException('Resource not found');
    try {
      return await this.resources.save(Object.assign(item, dto));
    } catch (err) {
      this.checkConflict(err);
      throw err;
    }
  }
  private checkConflict(err: unknown): void {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
      throw new ConflictException('Unique code or slug already exists');
    }
  }
}
