import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import type { UpdateProviderDisplayDto, ReorderProviderDisplayDto } from './provider-display.dto';

export const PROVIDER_DISPLAY_KEY = 'mocmaria.provider.display.v1';
type Visibility = 'VISIBLE' | 'HIDDEN' | 'ARCHIVED';
type Profile = {
  publicName?: string;
  serviceArea?: string;
  introduction?: string;
  title?: string;
  age?: number | null;
  yearsExperience?: number | null;
};
interface Settings {
  version: number;
  order: string[];
  profiles: Record<string, Profile & { visibility?: Visibility }>;
}
interface ProviderRow {
  id: string;
  publicName: string;
  serviceArea: string | null;
  introduction: string | null;
  applicationStatus: string;
  accountActive: boolean;
  publishable: boolean;
  avatarUrl: string | null;
  alias: string | null;
  age: number | null;
  yearsExperience: number | null;
  title: string | null;
}
export interface DisplayRow extends ProviderRow {
  visibility: Visibility;
}
export interface DisplaySnapshot {
  version: number;
  rows: DisplayRow[];
}
export interface PublicDisplaySnapshot {
  version: number;
  rows: Array<{
    providerId: string;
    visible: boolean;
    position?: number;
    publicName?: string;
    serviceArea?: string | null;
    introduction?: string;
    title?: string | null;
    age?: number | null;
    yearsExperience?: number | null;
  }>;
}

@Injectable()
export class ProviderDisplayService {
  constructor(private readonly db: DataSource) {}

  private admin(actor: AuthUserContext): void {
    if (
      !actor.permissions.includes('staff.manage') ||
      !actor.roles.some((r) => r === 'SUPER_ADMIN' || r === 'ADMIN')
    )
      throw new ForbiddenException('Cần quyền quản trị kỹ thuật viên.');
  }

  private async settings(m: EntityManager): Promise<Settings> {
    const [row] = await m.query<{ value: Settings }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [PROVIDER_DISPLAY_KEY],
    );
    return row?.value ?? { version: 0, order: [], profiles: {} };
  }

  private rows(m: EntityManager): Promise<ProviderRow[]> {
    return m.query(`SELECT p.id,p.public_name AS "publicName",p.service_area AS "serviceArea",
      p.introduction,p.status AS "applicationStatus",u.is_active AND COALESCE(s.is_active,false) AS "accountActive",
      (u.is_active AND COALESCE(s.is_active,false) AND
        (p.status='APPROVED' OR (p.status NOT IN ('REJECTED','SUSPENDED') AND seed.enabled='true'
          AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name='THERAPIST')))) AS publishable,
      COALESCE(s.avatar_url,catalog.profile->>'avatarUrl') AS "avatarUrl",seed.alias,
      COALESCE((age.value->>'age')::int,(catalog.profile->>'age')::int) AS age,
      (catalog.profile->>'yearsExperience')::int AS "yearsExperience",catalog.profile->>'title' AS title
      FROM provider_applications p JOIN users u ON u.id=p.user_id LEFT JOIN staff_profiles s ON s.user_id=u.id
      LEFT JOIN LATERAL (SELECT a->>'seedId' AS alias,a->>'chatEnabled' AS enabled FROM app_metadata m,
        jsonb_array_elements(COALESCE(m.value->'accounts','[]')) a
        WHERE m.key='mocmaria.ktv.accounts.v1' AND a->>'applicationId'=p.id::text LIMIT 1) seed ON true
      LEFT JOIN LATERAL (SELECT profile,ordinal FROM app_metadata m,
        jsonb_array_elements(COALESCE(m.value->'profiles','[]')) WITH ORDINALITY AS c(profile,ordinal)
        WHERE m.key='mocmaria.demo.ktv.v1' AND profile->>'id'=seed.alias LIMIT 1) catalog ON true
      LEFT JOIN app_metadata age ON age.key='mocmaria.provider.profile.'||p.id::text
      ORDER BY catalog.ordinal NULLS LAST,p.created_at,p.id`);
  }

  private snapshot(rows: ProviderRow[], settings: Settings): DisplaySnapshot {
    const positions = new Map(settings.order.map((id, i) => [id, i]));
    return {
      version: settings.version,
      rows: rows
        .map((row) => ({
          ...row,
          ...settings.profiles[row.id],
          visibility: settings.profiles[row.id]?.visibility ?? 'VISIBLE',
        }))
        .sort(
          (a, b) =>
            (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        ),
    };
  }

  async list(actor: AuthUserContext): Promise<DisplaySnapshot> {
    this.admin(actor);
    return this.db.transaction(async (m) =>
      this.snapshot(await this.rows(m), await this.settings(m)),
    );
  }

  async publicDisplay(): Promise<PublicDisplaySnapshot> {
    return this.db.transaction(async (m) => {
      const settings = await this.settings(m);
      const snapshot = this.snapshot(await this.rows(m), settings);
      let position = 0;
      return {
        version: snapshot.version,
        rows: snapshot.rows.map((row) =>
          row.visibility !== 'VISIBLE' || !row.publishable
            ? { providerId: row.id, visible: false }
            : {
                providerId: row.id,
                visible: true,
                position: ++position,
                publicName: row.publicName,
                serviceArea: row.serviceArea,
                introduction: settings.profiles[row.id]?.introduction,
                title: row.title,
                age: row.age,
                yearsExperience: row.yearsExperience,
              },
        ),
      };
    });
  }

  async applyDirectory<
    T extends { id: string; publicName: string; serviceArea: string | null; title: string },
  >(cards: T[]): Promise<T[]> {
    const display = await this.publicDisplay();
    const byId = new Map(display.rows.map((row) => [row.providerId, row]));
    return cards
      .filter((card) => byId.get(card.id)?.visible)
      .map((card) => {
        const row = byId.get(card.id)!;
        return {
          ...card,
          publicName: row.publicName ?? card.publicName,
          serviceArea: row.serviceArea ?? card.serviceArea,
          title: row.title || card.title,
        };
      })
      .sort((a, b) => (byId.get(a.id)?.position ?? 0) - (byId.get(b.id)?.position ?? 0));
  }

  private async write(
    actor: AuthUserContext,
    version: number,
    event: string,
    change: (s: Settings, rows: ProviderRow[]) => Record<string, unknown>,
  ): Promise<DisplaySnapshot> {
    this.admin(actor);
    return this.db.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [PROVIDER_DISPLAY_KEY]);
      const settings = await this.settings(m);
      if (settings.version !== version)
        throw new ConflictException(
          'Danh sách đã được quản trị viên khác cập nhật. Hãy tải lại trước khi lưu.',
        );
      const rows = await this.rows(m);
      const metadata = change(settings, rows);
      settings.version += 1;
      await m.query(
        `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
        [PROVIDER_DISPLAY_KEY, JSON.stringify(settings)],
      );
      await m.query(
        `INSERT INTO audit_logs(event,actor_user_id,metadata) VALUES($1,$2,$3::jsonb)`,
        [event, actor.id, JSON.stringify({ ...metadata, version: settings.version })],
      );
      return this.snapshot(rows, settings);
    });
  }

  reorder(actor: AuthUserContext, dto: ReorderProviderDisplayDto): Promise<DisplaySnapshot> {
    return this.write(actor, dto.expectedVersion, 'provider.display.reordered', (s, rows) => {
      const ids = new Set(rows.map((r) => r.id));
      if (
        dto.providerIds.length !== ids.size ||
        new Set(dto.providerIds).size !== ids.size ||
        dto.providerIds.some((id) => !ids.has(id))
      )
        throw new ConflictException('Danh sách KTV đã thay đổi. Hãy tải lại và sắp xếp lại.');
      s.order = [...dto.providerIds];
      return { providerIds: s.order };
    });
  }

  update(
    actor: AuthUserContext,
    id: string,
    dto: UpdateProviderDisplayDto,
  ): Promise<DisplaySnapshot> {
    return this.write(actor, dto.expectedVersion, 'provider.display.updated', (s, rows) => {
      if (!rows.some((r) => r.id === id)) throw new NotFoundException('Không tìm thấy KTV.');
      const patch = Object.fromEntries(
        [
          'visibility',
          'publicName',
          'serviceArea',
          'introduction',
          'title',
          'age',
          'yearsExperience',
        ]
          .filter((field) => dto[field as keyof UpdateProviderDisplayDto] !== undefined)
          .map((field) => [field, dto[field as keyof UpdateProviderDisplayDto]]),
      ) as Profile & { visibility?: Visibility };
      if (patch.publicName !== undefined && !patch.publicName?.trim())
        throw new BadRequestException('Tên KTV không được để trống.');
      if (patch.age != null && (!Number.isInteger(patch.age) || patch.age < 18 || patch.age > 100))
        throw new BadRequestException('Tuổi cần từ 18 đến 100.');
      if (
        patch.yearsExperience != null &&
        (!Number.isInteger(patch.yearsExperience) ||
          patch.yearsExperience < 0 ||
          patch.yearsExperience > 80)
      )
        throw new BadRequestException('Số năm kinh nghiệm không hợp lệ.');
      const previousVisibility = s.profiles[id]?.visibility ?? 'VISIBLE';
      s.profiles[id] = { ...s.profiles[id], ...patch };
      return {
        providerId: id,
        fields: Object.keys(patch),
        previousVisibility,
        visibility: patch.visibility,
      };
    });
  }
}
