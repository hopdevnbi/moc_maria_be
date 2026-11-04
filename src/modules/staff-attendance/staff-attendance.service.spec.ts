import { ForbiddenException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { Branch } from '../catalog/entities/branch.entity';
import type { AuthUserContext } from '../identity/identity.types';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { StaffCheckIn } from './entities/staff-check-in.entity';
import { StaffCoinWallet } from './entities/staff-coin-wallet.entity';
import {
  StaffAttendanceService,
  distanceInMeters,
  vietnamCalendarDate,
} from './staff-attendance.service';
import { StaffAttendanceStorage } from './staff-attendance.storage';

const employee: AuthUserContext = {
  id: '4d114b77-3d9d-4767-91e8-0414fb20a3bb',
  email: 'staff@example.test',
  phone: null,
  displayName: 'Staff',
  isActive: true,
  mustChangePassword: false,
  sessionId: 'session-1',
  roles: ['THERAPIST'],
  permissions: ['staff.portal'],
};
const branchId = '7c2a6449-1f5f-4fbe-b527-a6e14f077631';

function setup(
  branchLat: number | null,
  branchLon: number | null,
): {
  service: StaffAttendanceService;
  db: { transaction: jest.Mock };
  manager: { query: jest.Mock; getRepository: jest.Mock };
  attendanceRepo: { create: jest.Mock; save: jest.Mock };
  ledgerRepo: { insert: jest.Mock };
  branches: { findOne: jest.Mock; find: jest.Mock };
  staffProfiles: { findOne: jest.Mock };
} {
  const staffProfiles = { findOne: jest.fn().mockResolvedValue(null) };
  const branches = {
    findOne: jest.fn().mockResolvedValue({
      id: branchId,
      name: 'Mộc Maria',
      isActive: true,
      latitude: branchLat,
      longitude: branchLon,
    }),
    find: jest.fn().mockResolvedValue([]),
  };
  const checkIns = { findOne: jest.fn().mockResolvedValue(null), find: jest.fn() };
  const wallets = { findOne: jest.fn().mockResolvedValue(null) };
  const attendanceRepo = {
    create: jest.fn((data: object) => data),
    save: jest.fn((data: object) => Promise.resolve({ ...data, id: 'check-in-id' })),
  };
  const ledgerRepo = { insert: jest.fn().mockResolvedValue({}) };
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === StaffCheckIn ? attendanceRepo : ledgerRepo,
    ),
    query: jest.fn().mockResolvedValue([]),
  };
  const db = {
    transaction: jest.fn(async (callback: (manager: unknown) => Promise<void>) =>
      callback(manager),
    ),
  };
  const service = new StaffAttendanceService(
    db as unknown as DataSource,
    checkIns as unknown as Repository<StaffCheckIn>,
    wallets as unknown as Repository<StaffCoinWallet>,
    branches as unknown as Repository<Branch>,
    staffProfiles as unknown as Repository<StaffProfile>,
    {} as StaffAttendanceStorage,
  );
  jest.spyOn(service, 'me').mockResolvedValue({
    localDate: '2026-11-04',
    today: { id: 'check-in-id' },
    wallet: { balance: 0, totalEarned: 0 },
    branches: [],
    policy: {},
  });
  return { service, db, manager, attendanceRepo, ledgerRepo, branches, staffProfiles };
}

describe('staff attendance', () => {
  it('uses Vietnam calendar boundaries rather than UTC calendar days', () => {
    expect(vietnamCalendarDate(new Date('2026-11-04T16:59:59.999Z'))).toBe('2026-11-04');
    expect(vietnamCalendarDate(new Date('2026-11-04T17:00:00.000Z'))).toBe('2026-11-05');
  });

  it('measures geographic distances in metres', () => {
    expect(distanceInMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 })).toBe(0);
    expect(
      distanceInMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.001 }),
    ).toBeCloseTo(111.2, 0);
  });

  it('awards five coins atomically for a valid in-range check-in', async () => {
    const { service, manager, ledgerRepo, attendanceRepo } = setup(21, 105);
    const result = await service.create(employee, {
      branchId,
      latitude: 21,
      longitude: 105,
      accuracyMeters: 10,
    });
    expect(attendanceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'IN_RANGE',
        distanceMeters: 0,
        coinsEarned: 5,
      }),
    );
    expect(ledgerRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5,
        reason: 'CHECK_IN',
      }),
    );
    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ alreadyCheckedIn: false });
  });

  it('records an outside check-in but never awards coins', async () => {
    const { service, ledgerRepo, manager, attendanceRepo } = setup(21, 105);
    await service.create(employee, { branchId, latitude: 21.01, longitude: 105 });
    expect(attendanceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'OUT_OF_RANGE',
        coinsEarned: 0,
      }),
    );
    expect(ledgerRepo.insert).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('records missing branch location with zero coins', async () => {
    const { service, ledgerRepo, attendanceRepo } = setup(null, null);
    await service.create(employee, { branchId, latitude: 21, longitude: 105 });
    expect(attendanceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'LOCATION_NOT_CONFIGURED',
        coinsEarned: 0,
      }),
    );
    expect(ledgerRepo.insert).not.toHaveBeenCalled();
  });

  it('blocks customer-only check-in', async () => {
    const { service, db } = setup(21, 105);
    await expect(
      service.create({ ...employee, roles: ['CUSTOMER'] }, { branchId }),
    ).rejects.toThrow(ForbiddenException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('treats a duplicate daily check-in as idempotent without another coin award', async () => {
    const { service, db, manager } = setup(21, 105);
    db.transaction.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), {
        code: '23505',
        constraint: 'uq_staff_checkin_user_local_date',
      }),
    );
    const result = await service.create(employee, { branchId, latitude: 21, longitude: 105 });
    expect(result).toMatchObject({ alreadyCheckedIn: true });
    expect(manager.query).not.toHaveBeenCalled();
  });
});
