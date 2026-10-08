import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Branch } from './entities/branch.entity';
import { BranchResource } from './entities/branch-resource.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { SaveCategoryDto } from './dto/save-category.dto';
import { SaveResourceDto } from './dto/save-resource.dto';
import { CreateServiceDto, CreateVariantDto, SetBranchServiceDto } from './dto/service-catalog.dto';
import { Service } from './entities/service.entity';
import { ServiceVariant } from './entities/service-variant.entity';
import { BranchService } from './entities/branch-service.entity';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    @InjectRepository(BranchResource) private readonly resources: Repository<BranchResource>,
    @InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>,
    @InjectRepository(Service) private readonly services: Repository<Service>,
    @InjectRepository(ServiceVariant) private readonly variants: Repository<ServiceVariant>,
    @InjectRepository(BranchService) private readonly branchServices: Repository<BranchService>,
  ) {}

  async publicServices(): Promise<Array<{ service: Service; variants: ServiceVariant[] }>> {
    const categories = await this.categories.find({ where: { isPublished: true } });
    if (!categories.length) return [];
    const items = await this.services.find({
      where: { isPublished: true },
      order: { name: 'ASC' },
    });
    const allowed = items.filter((s) => categories.some((c) => c.id === s.categoryId));
    return Promise.all(
      allowed.map(async (service) => ({
        service,
        variants: await this.variants.find({ where: { serviceId: service.id, isActive: true } }),
      })),
    );
  }

  adminServices(): Promise<Service[]> {
    return this.services.find({ order: { name: 'ASC' } });
  }

  async addService(dto: CreateServiceDto): Promise<Service> {
    if (!(await this.categories.findOneBy({ id: dto.categoryId })))
      throw new NotFoundException('Category not found');
    try {
      return await this.services.save(this.services.create({ ...dto, name: dto.name.trim() }));
    } catch (err) {
      this.checkConflict(err);
      throw err;
    }
  }

  async addVariant(serviceId: string, dto: CreateVariantDto): Promise<ServiceVariant> {
    if (!(await this.services.findOneBy({ id: serviceId })))
      throw new NotFoundException('Service not found');
    return this.variants.save(
      this.variants.create({ ...dto, serviceId, priceVnd: String(dto.priceVnd) }),
    );
  }

  async setBranchService(branchId: string, dto: SetBranchServiceDto): Promise<BranchService> {
    if (!(await this.branches.findOneBy({ id: branchId })))
      throw new NotFoundException('Branch not found');
    if (!(await this.services.findOneBy({ id: dto.serviceId })))
      throw new NotFoundException('Service not found');
    const existing = await this.branchServices.findOneBy({ branchId, serviceId: dto.serviceId });
    return this.branchServices.save(
      this.branchServices.create({
        ...existing,
        branchId,
        serviceId: dto.serviceId,
        isActive: dto.isActive ?? existing?.isActive ?? true,
        priceOverrideVnd:
          dto.priceOverrideVnd === undefined
            ? (existing?.priceOverrideVnd ?? null)
            : dto.priceOverrideVnd === null
              ? null
              : String(dto.priceOverrideVnd),
      }),
    );
  }

  async publicBranchServices(
    branchId: string,
  ): Promise<
    Array<{ service: Service; variants: ServiceVariant[]; priceOverrideVnd: string | null }>
  > {
    if (!(await this.branches.findOneBy({ id: branchId, isActive: true })))
      throw new NotFoundException('Branch not found');
    const mappings = await this.branchServices.find({ where: { branchId, isActive: true } });
    const published = await this.publicServices();
    return mappings.flatMap((mapping) => {
      const found = published.find(({ service }) => service.id === mapping.serviceId);
      return found ? [{ ...found, priceOverrideVnd: mapping.priceOverrideVnd }] : [];
    });
  }

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
