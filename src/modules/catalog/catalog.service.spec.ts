import { ConflictException, NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Branch } from './entities/branch.entity';
import { BranchResource } from './entities/branch-resource.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { Repository } from 'typeorm';

describe('CatalogService guardrails', () => {
  const branches = { findOneBy: jest.fn() };
  const resources = { find: jest.fn(), findOneBy: jest.fn(), create: jest.fn(), save: jest.fn() };
  const categories = { find: jest.fn(), findOneBy: jest.fn(), create: jest.fn(), save: jest.fn() };
  const service = new CatalogService(
    branches as unknown as Repository<Branch>,
    resources as unknown as Repository<BranchResource>,
    categories as unknown as Repository<ServiceCategory>,
  );

  beforeEach(() => jest.clearAllMocks());

  it('exposes only published categories to the public', async () => {
    categories.find.mockResolvedValue([]);
    await service.publicCategories();
    expect(categories.find).toHaveBeenCalledWith({
      where: { isPublished: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  });

  it('hides inactive resources from public listing', async () => {
    branches.findOneBy.mockResolvedValue({ id: 'branch-id', isActive: true });
    resources.find.mockResolvedValue([]);
    await service.branchResources('branch-id');
    expect(resources.find).toHaveBeenCalledWith({
      where: { branchId: 'branch-id', isActive: true },
      order: { name: 'ASC' },
    });
  });

  it('rejects creating resources for nonexistent branches', async () => {
    branches.findOneBy.mockResolvedValue(null);
    await expect(
      service.createResource('missing', {
        name: 'Spa room',
        code: 'spa-room',
        kind: 'ROOM',
        capacity: 1,
      }),
    ).rejects.toThrow(NotFoundException);
    expect(resources.save).not.toHaveBeenCalled();
  });

  it('rejects duplicate category slug', async () => {
    categories.create.mockReturnValue({ name: 'Massage', slug: 'massage' });
    categories.save.mockRejectedValue({ code: '23505' });
    await expect(service.saveCategory({ name: 'Massage', slug: 'massage' })).rejects.toThrow(
      ConflictException,
    );
  });
});
