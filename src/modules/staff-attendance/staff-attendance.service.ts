import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { StaffProfile } from '../identity/entities/staff-profile.entity';
import { Branch } from '../catalog/entities/branch.entity';
import { StaffCheckIn, type CheckInStatus } from './entities/staff-check-in.entity';
import { StaffCoinLedger } from './entities/staff-coin-ledger.entity';
import { StaffCoinWallet } from './entities/staff-coin-wallet.entity';
import type { CreateStaffCheckInDto } from './dto/check-in.dto';
import type { ListStaffCheckInsDto } from './dto/list-check-ins.dto';
import { StaffAttendanceStorage, type AttendanceImageFile } from './staff-attendance.storage';

export const ATTENDANCE_RADIUS_METERS = 200;
export const ATTENDANCE_COIN_REWARD = 5;
export const ATTENDANCE_TIMEZONE = 'Asia/Ho_Chi_Minh';
const EMPLOYEE_ROLES = new Set([
  'BRANCH_MANAGER',
  'RECEPTIONIST',
  'THERAPIST',
  'DOCTOR_CONSULTANT',
]);

export function vietnamCalendarDate(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ATTENDANCE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (key: string): string => parts.find((part) => part.type === key)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function distanceInMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

@Injectable()
export class StaffAttendanceService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(StaffCheckIn) private readonly checkIns: Repository<StaffCheckIn>,
    @InjectRepository(StaffCoinWallet) private readonly wallets: Repository<StaffCoinWallet>,
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    @InjectRepository(StaffProfile) private readonly staffProfiles: Repository<StaffProfile>,
    private readonly storage: StaffAttendanceStorage,
  ) {}

  private async assertEmployee(actor: AuthUserContext): Promise<void> {
    if (!actor.isActive) throw new ForbiddenException('Tài khoản đã bị vô hiệu hóa.');
    const profile = await this.staffProfiles.findOne({ where: { userId: actor.id } });
    const employeeRole = actor.roles.some((role) => EMPLOYEE_ROLES.has(role));
    if ((profile && !profile.isActive) || (!employeeRole && !profile?.isActive))
      throw new ForbiddenException('Chỉ nhân viên và KTV của Mộc Maria được check-in.');
  }

  async me(actor: AuthUserContext): Promise<unknown> {
    await this.assertEmployee(actor);
    const localDate = vietnamCalendarDate(new Date());
    const [today, wallet, branches] = await Promise.all([
      this.checkIns.findOne({ where: { userId: actor.id, localDate } }),
      this.wallets.findOne({ where: { userId: actor.id } }),
      this.branches.find({ where: { isActive: true }, order: { name: 'ASC' } }),
    ]);
    return {
      localDate,
      today,
      wallet: { balance: wallet?.balance ?? 0, totalEarned: wallet?.totalEarned ?? 0 },
      branches: branches.map((branch) => ({
        id: branch.id,
        name: branch.name,
        address: branch.address,
        latitude: branch.latitude,
        longitude: branch.longitude,
        locationConfigured: branch.latitude != null && branch.longitude != null,
      })),
      policy: {
        timezone: ATTENDANCE_TIMEZONE,
        radiusMeters: ATTENDANCE_RADIUS_METERS,
        coinsPerValidCheckIn: ATTENDANCE_COIN_REWARD,
        maxCheckInsPerDay: 1,
      },
    };
  }

  async history(actor: AuthUserContext, rawLimit?: string): Promise<StaffCheckIn[]> {
    await this.assertEmployee(actor);
    const limit = rawLimit === undefined ? 30 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('limit phải là số từ 1 đến 100.');
    return this.checkIns.find({
      where: { userId: actor.id },
      order: { localDate: 'DESC' },
      take: limit,
    });
  }

  async create(actor: AuthUserContext, dto: CreateStaffCheckInDto): Promise<unknown> {
    await this.assertEmployee(actor);
    const hasLatitude = dto.latitude !== undefined && dto.latitude !== null;
    const hasLongitude = dto.longitude !== undefined && dto.longitude !== null;
    if (hasLatitude !== hasLongitude)
      throw new BadRequestException('Vui lòng cung cấp cả vĩ độ và kinh độ.');
    const localDate = vietnamCalendarDate(new Date());
    // Resolve a retry before validating new location/branch data: the daily record is final.
    const existing = await this.checkIns.findOne({ where: { userId: actor.id, localDate } });
    if (existing)
      return { ...((await this.me(actor)) as Record<string, unknown>), alreadyCheckedIn: true };
    if (
      hasLatitude &&
      hasLongitude &&
      (typeof dto.accuracyMeters !== 'number' ||
        !Number.isFinite(dto.accuracyMeters) ||
        dto.accuracyMeters < 0 ||
        dto.accuracyMeters > 100)
    )
      throw new BadRequestException(
        'GPS chưa đủ chính xác (sai số tối đa 100m). Hãy lấy lại vị trí hoặc chọn check-in không có GPS. Chưa ghi nhận lượt điểm danh.',
      );
    const branch = await this.branches.findOne({ where: { id: dto.branchId, isActive: true } });
    if (!branch) throw new NotFoundException('Không tìm thấy cơ sở Mộc Maria đang hoạt động.');
    let status: CheckInStatus = 'LOCATION_UNAVAILABLE';
    let distanceMeters: number | null = null;
    if (branch.latitude == null || branch.longitude == null) status = 'LOCATION_NOT_CONFIGURED';
    else if (hasLatitude && hasLongitude) {
      const distance = distanceInMeters(
        { latitude: dto.latitude!, longitude: dto.longitude! },
        { latitude: branch.latitude, longitude: branch.longitude },
      );
      distanceMeters = Number(distance.toFixed(2));
      status = distance <= ATTENDANCE_RADIUS_METERS ? 'IN_RANGE' : 'OUT_OF_RANGE';
    }
    const coinsEarned = status === 'IN_RANGE' ? ATTENDANCE_COIN_REWARD : 0;
    try {
      await this.dataSource.transaction(async (manager) => {
        const saved = await manager.getRepository(StaffCheckIn).save(
          manager.getRepository(StaffCheckIn).create({
            userId: actor.id,
            branchId: branch.id,
            localDate,
            latitude: hasLatitude ? dto.latitude! : null,
            longitude: hasLongitude ? dto.longitude! : null,
            accuracyMeters: dto.accuracyMeters ?? null,
            distanceMeters,
            status,
            coinsEarned,
            selfieUrl: null,
          }),
        );
        // DB UNIQUE(user_id, local_date) protects concurrent check-in requests.
        if (coinsEarned === 0) return;
        await manager.getRepository(StaffCoinLedger).insert({
          userId: actor.id,
          checkInId: saved.id,
          amount: ATTENDANCE_COIN_REWARD,
          reason: 'CHECK_IN',
        });
        await manager.query(
          `INSERT INTO staff_coin_wallets (user_id,balance,total_earned) VALUES ($1,$2,$2)
           ON CONFLICT (user_id) DO UPDATE SET
             balance=staff_coin_wallets.balance+EXCLUDED.balance,
             total_earned=staff_coin_wallets.total_earned+EXCLUDED.total_earned,
             updated_at=now()`,
          [actor.id, ATTENDANCE_COIN_REWARD],
        );
      });
      return { ...((await this.me(actor)) as Record<string, unknown>), alreadyCheckedIn: false };
    } catch (error) {
      const dbError = error as {
        code?: string;
        constraint?: string;
        driverError?: { code?: string; constraint?: string };
      };
      if (
        (dbError.code ?? dbError.driverError?.code) === '23505' &&
        (dbError.constraint ?? dbError.driverError?.constraint) ===
          'uq_staff_checkin_user_local_date'
      )
        return { ...((await this.me(actor)) as Record<string, unknown>), alreadyCheckedIn: true };
      throw error;
    }
  }

  async uploadSelfie(
    actor: AuthUserContext,
    id: string,
    file?: AttendanceImageFile,
  ): Promise<StaffCheckIn> {
    await this.assertEmployee(actor);
    const checkIn = await this.checkIns.findOne({ where: { id, userId: actor.id } });
    if (!checkIn) throw new NotFoundException('Không tìm thấy lượt check-in.');
    if (checkIn.selfieUrl) throw new ConflictException('Lượt check-in đã có ảnh selfie.');
    const url = await this.storage.upload(checkIn, file);
    const updated = await this.checkIns
      .createQueryBuilder()
      .update(StaffCheckIn)
      .set({ selfieUrl: url })
      .where('id = :id AND user_id = :userId AND selfie_url IS NULL', { id, userId: actor.id })
      .execute();
    if (!updated.affected) throw new ConflictException('Lượt check-in đã có ảnh selfie.');
    return (await this.checkIns.findOne({ where: { id, userId: actor.id } }))!;
  }

  async listAdmin(dto: ListStaffCheckInsDto): Promise<unknown> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 30;
    const query = this.checkIns
      .createQueryBuilder('attendance')
      .leftJoinAndSelect('attendance.user', 'employee')
      .leftJoinAndSelect('attendance.branch', 'branch');
    if (dto.date) query.andWhere('attendance.localDate = :localDate', { localDate: dto.date });
    if (dto.branchId) query.andWhere('attendance.branchId = :branchId', { branchId: dto.branchId });
    if (dto.status) query.andWhere('attendance.status = :status', { status: dto.status });
    query
      .orderBy('attendance.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    const [items, total] = await query.getManyAndCount();
    return {
      items: items.map(({ user, branch, ...item }) => ({
        ...item,
        employee: user
          ? { displayName: user.displayName, email: user.email, phone: user.phone }
          : null,
        branch: branch ? { name: branch.name, address: branch.address } : null,
      })),
      total,
      page,
      limit,
    };
  }

  async summary(date?: string): Promise<unknown> {
    const localDate = date ?? vietnamCalendarDate(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate))
      throw new BadRequestException('Ngày phải có định dạng YYYY-MM-DD.');
    const rows = await this.checkIns
      .createQueryBuilder('attendance')
      .select('attendance.status', 'status')
      .addSelect('COUNT(*)::integer', 'count')
      .addSelect('COALESCE(SUM(attendance.coinsEarned),0)::integer', 'coins')
      .where('attendance.localDate = :localDate', { localDate })
      .groupBy('attendance.status')
      .getRawMany<{ status: CheckInStatus; count: number; coins: number }>();
    const statuses = {
      IN_RANGE: 0,
      OUT_OF_RANGE: 0,
      LOCATION_NOT_CONFIGURED: 0,
      LOCATION_UNAVAILABLE: 0,
    };
    let totalCoinsAwarded = 0;
    for (const row of rows) {
      statuses[row.status] = Number(row.count);
      totalCoinsAwarded += Number(row.coins);
    }
    return {
      localDate,
      total: Object.values(statuses).reduce((sum, count) => sum + count, 0),
      statuses,
      totalCoinsAwarded,
    };
  }

  async adminBranches(): Promise<unknown> {
    const branches = await this.branches.find({ order: { name: 'ASC' } });
    return {
      radiusMeters: ATTENDANCE_RADIUS_METERS,
      timezone: ATTENDANCE_TIMEZONE,
      branches: branches.map(({ id, name, address, latitude, longitude, isActive }) => ({
        id,
        name,
        address,
        latitude,
        longitude,
        isActive,
        locationConfigured: latitude != null && longitude != null,
      })),
      updateLocationVia: 'PATCH /admin/branches/:id',
    };
  }
}
