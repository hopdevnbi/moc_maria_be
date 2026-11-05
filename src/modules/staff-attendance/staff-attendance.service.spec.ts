import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { Branch } from '../catalog/entities/branch.entity';
import type { AuthUserContext } from '../identity/identity.types';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { AuditLog } from '../identity/entities/audit-log.entity';
import { StaffCheckIn } from './entities/staff-check-in.entity';
import { StaffCoinWallet } from './entities/staff-coin-wallet.entity';
import {
  StaffAttendanceService,
  customerDeviceHash,
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
  attendanceRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock; remove: jest.Mock };
  ledgerRepo: { insert: jest.Mock; findOne: jest.Mock; remove: jest.Mock };
  auditRepo: { save: jest.Mock };
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
    findOne: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const ledgerRepo = {
    insert: jest.fn().mockResolvedValue({}),
    findOne: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const auditRepo = { save: jest.fn().mockResolvedValue(undefined) };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === StaffCheckIn) return attendanceRepo;
      if (entity === AuditLog) return auditRepo;
      return ledgerRepo;
    }),
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
  return { service, db, manager, attendanceRepo, ledgerRepo, auditRepo, branches, staffProfiles };
}

describe('staff attendance', () => {
  const superAdmin: AuthUserContext = {
    ...employee,
    roles: ['SUPER_ADMIN'],
    permissions: ['staff.manage', 'admin.portal'],
  };
  const recordId = 'f2d1138b-895a-40be-b9ce-59cd4637e431';
  const checkIn = {
    id: recordId,
    userId: employee.id,
    branchId,
    localDate: '2026-11-05',
    status: 'IN_RANGE',
    coinsEarned: 5,
    selfieUrl: 'https://giangxa-media-cdn.b-cdn.net/moc-maria/staff-attendance/image.webp',
  };

  it('rejects deletion from KTV/admin without Super Admin and from disabled Super Admin', async () => {
    const { service, db } = setup(21, 105);
    for (const actor of [
      employee,
      { ...employee, roles: ['ADMIN'] as AuthUserContext['roles'] },
      { ...superAdmin, isActive: false },
    ]) {
      await expect(service.deleteCheckIn(actor, recordId)).rejects.toThrow(ForbiddenException);
    }
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('atomically undoes earned coins, deletes ledger/check-in and preserves a Super Admin audit trail', async () => {
    const { service, manager, attendanceRepo, ledgerRepo, auditRepo } = setup(21, 105);
    attendanceRepo.findOne.mockResolvedValueOnce({ ...checkIn });
    ledgerRepo.findOne.mockResolvedValueOnce({ checkInId: recordId, amount: 5 });
    manager.query.mockResolvedValueOnce([{ user_id: employee.id }]);
    expect(await service.deleteCheckIn(superAdmin, recordId)).toEqual({
      deleted: true,
      id: recordId,
      localDate: '2026-11-05',
      coinsReversed: 5,
    });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('total_earned = total_earned - $2'),
      [employee.id, 5],
    );
    expect(ledgerRepo.remove).toHaveBeenCalledTimes(1);
    expect(attendanceRepo.remove).toHaveBeenCalledWith(expect.objectContaining({ id: recordId }));
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'staff.attendance.admin_deleted',
        actorUserId: superAdmin.id,
        targetUserId: employee.id,
      }),
    );
    const auditCalls = auditRepo.save.mock.calls as unknown as Array<
      [{ metadata: Record<string, unknown> }]
    >;
    expect(auditCalls[0]?.[0].metadata).toMatchObject({
      checkInId: recordId,
      coinsReversed: 5,
      hadSelfie: true,
    });
  });

  it('deletes a 0-coin record without modifying wallets and records the action', async () => {
    const { service, manager, attendanceRepo, ledgerRepo, auditRepo } = setup(21, 105);
    attendanceRepo.findOne.mockResolvedValueOnce({
      ...checkIn,
      status: 'LOCATION_UNAVAILABLE',
      coinsEarned: 0,
      selfieUrl: null,
    });
    ledgerRepo.findOne.mockResolvedValueOnce(null);
    const result = await service.deleteCheckIn(superAdmin, recordId);
    expect(result.coinsReversed).toBe(0);
    expect(manager.query).not.toHaveBeenCalled();
    expect(ledgerRepo.remove).not.toHaveBeenCalled();
    expect(attendanceRepo.remove).toHaveBeenCalledTimes(1);
    expect(auditRepo.save).toHaveBeenCalledTimes(1);
  });

  it('does not permit duplicate deletes or a negative balance when coin was already spent', async () => {
    const { service, manager, attendanceRepo, ledgerRepo, auditRepo } = setup(21, 105);
    attendanceRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...checkIn });
    ledgerRepo.findOne.mockResolvedValueOnce({ checkInId: recordId, amount: 5 });
    await expect(service.deleteCheckIn(superAdmin, recordId)).rejects.toThrow(NotFoundException);
    manager.query.mockResolvedValueOnce([]);
    await expect(service.deleteCheckIn(superAdmin, recordId)).rejects.toThrow(ConflictException);
    expect(attendanceRepo.remove).not.toHaveBeenCalled();
    expect(ledgerRepo.remove).not.toHaveBeenCalled();
    expect(auditRepo.save).not.toHaveBeenCalled();
  });

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
    await service.create(employee, {
      branchId,
      latitude: 21.01,
      longitude: 105,
      accuracyMeters: 15,
    });
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
    await service.create(employee, { branchId, latitude: 21, longitude: 105, accuracyMeters: 15 });
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
    const result = await service.create(employee, {
      branchId,
      latitude: 21,
      longitude: 105,
      accuracyMeters: 15,
    });
    expect(result).toMatchObject({ alreadyCheckedIn: true });
    expect(manager.query).not.toHaveBeenCalled();
  });

  it.each([undefined, 101, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects imprecise GPS before consuming the daily attendance for accuracy %s',
    async (accuracyMeters) => {
      const { service, db } = setup(21, 105);
      await expect(
        service.create(employee, { branchId, latitude: 21, longitude: 105, accuracyMeters }),
      ).rejects.toThrow(BadRequestException);
      expect(db.transaction).not.toHaveBeenCalled();
    },
  );

  it('records explicitly missing GPS without coins', async () => {
    const { service, attendanceRepo, ledgerRepo } = setup(21, 105);
    await service.create(employee, { branchId });
    expect(attendanceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'LOCATION_UNAVAILABLE', coinsEarned: 0 }),
    );
    expect(ledgerRepo.insert).not.toHaveBeenCalled();
  });
});

describe('customer attendance (100m and 1 browser installation per day)', () => {
  const customer: AuthUserContext = { ...employee, roles: ['CUSTOMER'], permissions: [] };
  const deviceId = '4141b6a9-e657-431c-b422-3f38a61596dc';
  const dto = {
    branchId,
    deviceId,
    latitude: 21,
    longitude: 105,
    accuracyMeters: 12,
  };

  it('does not accept privileged staff or inactive accounts as customers', async () => {
    const { service, db } = setup(21, 105);
    for (const actor of [
      employee,
      { ...customer, roles: ['SUPER_ADMIN'] as AuthUserContext['roles'] },
      { ...customer, isActive: false },
    ]) {
      await expect(service.customerCreate(actor, dto)).rejects.toThrow(ForbiddenException);
    }
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('accepts a signed-in user with no job roles', async () => {
    const { service, attendanceRepo } = setup(21, 105);
    await service.customerCreate({ ...customer, roles: [] }, dto);
    expect(attendanceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ checkinCategory: 'CUSTOMER', coinsEarned: 5 }),
    );
  });

  it('rejects out-of-range check-ins without using a daily slot or coins', async () => {
    const { service, db } = setup(21.003, 105);
    await expect(service.customerCreate(customer, dto)).rejects.toThrow(/100m/);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it.each([undefined, 51, 100, -1, Number.NaN])(
    'rejects inaccurate or missing GPS, accuracy %s',
    async (accuracyMeters) => {
      const { service, db } = setup(21, 105);
      await expect(service.customerCreate(customer, { ...dto, accuracyMeters })).rejects.toThrow(
        BadRequestException,
      );
      expect(db.transaction).not.toHaveBeenCalled();
    },
  );

  it('atomically rewards exactly 5 coins and stores only an opaque device hash', async () => {
    const { service, manager, attendanceRepo, ledgerRepo } = setup(21, 105);
    const result = await service.customerCreate(customer, dto);
    expect(result).toMatchObject({ alreadyCheckedIn: false });
    expect(attendanceRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'IN_RANGE',
        coinsEarned: 5,
        customerDeviceHash: customerDeviceHash(deviceId),
        checkinCategory: 'CUSTOMER',
      }),
    );
    expect(customerDeviceHash(deviceId)).not.toContain(deviceId);
    expect(ledgerRepo.insert).toHaveBeenCalledTimes(1);
    expect(ledgerRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5,
        reason: 'CUSTOMER_CHECK_IN',
      }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO staff_coin_wallets'),
      [customer.id, 5],
    );
  });

  it('blocks reuse of the same browser on a different account today', async () => {
    const { service, db, manager } = setup(21, 105);
    db.transaction.mockRejectedValueOnce(
      Object.assign(new Error('duplicate device'), {
        code: '23505',
        constraint: 'uq_customer_checkin_device_date',
      }),
    );
    await expect(service.customerCreate(customer, dto)).rejects.toThrow(ConflictException);
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('is idempotent for an already checked-in customer account', async () => {
    const { service, db } = setup(21, 105);
    db.transaction.mockRejectedValueOnce(
      Object.assign(new Error('duplicate account'), {
        code: '23505',
        constraint: 'uq_staff_checkin_user_local_date',
      }),
    );
    expect(await service.customerCreate(customer, dto)).toMatchObject({ alreadyCheckedIn: true });
  });
});
