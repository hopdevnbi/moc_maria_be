import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import type { CreateKtvDto } from './create-ktv.dto';

const ACCOUNTS_KEY = 'mocmaria.ktv.accounts.v1';
const CATALOG_KEY = 'mocmaria.demo.ktv.v1';

const titles: Record<string, string> = {
  'demo-relaxation': 'Chăm sóc cổ vai gáy chuyên sâu',
  'demo-hot-stone': 'Chăm sóc cổ vai gáy lưng eo',
  'demo-neck': 'Massage chân',
  'demo-foot': 'Massage body',
  'demo-herbal': 'Massage bầu',
  'demo-pressure': 'Chăm sóc giải cảm',
  'demo-aroma': 'Combo giác hơi ngải cứu',
  'demo-thai': 'Chăm sóc giấc ngủ',
  'demo-back': 'Chăm sóc vùng đầu',
  'demo-hair': 'Gội đầu sạch',
};

type Registry = { accounts: Array<Record<string, unknown>>; [field: string]: unknown };
type Catalog = { profiles: Array<Record<string, unknown>>; [field: string]: unknown };
export interface CreatedKtv {
  userId: string;
  providerId: string;
  alias: string;
  username: string;
  temporaryPassword: string;
  mustChangePassword: true;
}

function nameSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')
    .slice(0, 60);
}

@Injectable()
export class KtvOnboardingService {
  constructor(private readonly db: DataSource) {}

  async create(actor: AuthUserContext, dto: CreateKtvDto): Promise<CreatedKtv> {
    if (!actor.roles.includes('SUPER_ADMIN') || !actor.permissions.includes('staff.manage'))
      throw new ForbiddenException('Chỉ Super Admin được tạo tài khoản KTV.');

    const publicName = dto.publicName.trim();
    if (publicName.length < 2) throw new BadRequestException('Tên KTV quá ngắn.');
    const slug = nameSlug(publicName);
    if (!slug) throw new BadRequestException('Tên KTV không tạo được định danh đăng nhập.');
    const username = `${slug}.${randomBytes(4).toString('hex')}@mocmaria.com`;
    const temporaryPassword = 'Mm9-' + randomBytes(20).toString('base64url');
    const passwordHash = await argon2.hash(temporaryPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const userId = randomUUID();
    const providerId = randomUUID();
    const aliasBase = 'ktv-' + slug.replaceAll('.', '-');
    // Link the owner-published Thanh Thanh introduction to its new real identity.
    const alias =
      aliasBase === 'ktv-thanh-thanh' ? aliasBase : aliasBase + '-' + userId.slice(0, 8);

    await this.db.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(1791663000)');
      const [registryRow] = await manager.query<{ value: Registry }[]>(
        'SELECT value FROM app_metadata WHERE key=$1 FOR UPDATE',
        [ACCOUNTS_KEY],
      );
      const [catalogRow] = await manager.query<{ value: Catalog }[]>(
        'SELECT value FROM app_metadata WHERE key=$1 FOR UPDATE',
        [CATALOG_KEY],
      );
      if (!registryRow || !Array.isArray(registryRow.value?.accounts))
        throw new BadRequestException('Chưa cấu hình sổ đăng ký KTV hiện tại.');
      if (!catalogRow || !Array.isArray(catalogRow.value?.profiles))
        throw new BadRequestException('Chưa cấu hình danh mục hồ sơ KTV.');
      if (
        registryRow.value.accounts.some((entry) => entry['seedId'] === alias) ||
        catalogRow.value.profiles.some((entry) => entry['id'] === alias)
      )
        throw new ConflictException('Định danh KTV đã tồn tại.');
      const [role] = await manager.query<{ id: string }[]>(
        "SELECT id FROM roles WHERE name='THERAPIST'",
      );
      if (!role) throw new BadRequestException('Chưa cấu hình quyền KTV.');
      await manager.query(
        'INSERT INTO users(id,email,display_name,password_hash,is_active,must_change_password) VALUES($1,$2,$3,$4,true,true)',
        [userId, username, publicName, passwordHash],
      );
      await manager.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
        userId,
        role.id,
      ]);
      await manager.query(
        'INSERT INTO staff_profiles(user_id,public_name,avatar_url,bio,is_active,is_public) VALUES($1,$2,NULL,$3,true,false)',
        [userId, publicName, dto.introduction?.trim() || null],
      );
      await manager.query(
        "INSERT INTO provider_applications(id,user_id,public_name,introduction,service_area,status,review_note) VALUES($1,$2,$3,$4,$5,'APPLIED',$6)",
        [
          providerId,
          userId,
          publicName,
          dto.introduction?.trim() || null,
          dto.serviceArea?.trim() || 'Hà Nội',
          'Tài khoản mới do Super Admin tạo; chưa cấp chứng nhận hoặc quyền nhận lịch.',
        ],
      );

      const accounts = [
        ...registryRow.value.accounts,
        {
          seedId: alias,
          userId,
          applicationId: providerId,
          chatEnabled: true,
          scheduleOpen: false,
        },
      ];
      const profiles = [
        ...catalogRow.value.profiles,
        {
          id: alias,
          publicName,
          title: dto.title?.trim() || 'Kỹ thuật viên Mộc Maria',
          introduction: dto.introduction?.trim() || null,
          serviceArea: dto.serviceArea?.trim() || 'Hà Nội',
          avatarUrl: null,
          isDemo: true,
          bookable: false,
          eligibleServices: [],
          demoServices: dto.serviceIds.map((id) => ({
            id,
            name: titles[id],
            durationMinutes: 0,
            priceVnd: 0,
          })),
          scheduleOpen: false,
          weeklySchedule: null,
        },
      ];
      await manager.query('UPDATE app_metadata SET value=$2::jsonb,updated_at=now() WHERE key=$1', [
        ACCOUNTS_KEY,
        JSON.stringify({ ...registryRow.value, accounts }),
      ]);
      await manager.query('UPDATE app_metadata SET value=$2::jsonb,updated_at=now() WHERE key=$1', [
        CATALOG_KEY,
        JSON.stringify({ ...catalogRow.value, profiles }),
      ]);
      await manager.query(
        "INSERT INTO audit_logs(event,actor_user_id,target_user_id,metadata) VALUES('provider.staff.onboarded',$1,$2,$3::jsonb)",
        [
          actor.id,
          userId,
          JSON.stringify({
            providerId,
            alias,
            menuCount: dto.serviceIds.length,
            bookingEnabled: false,
          }),
        ],
      );
    });
    return { userId, providerId, alias, username, temporaryPassword, mustChangePassword: true };
  }
}
