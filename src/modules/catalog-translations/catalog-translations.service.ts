import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import { normalizeLocale, type Locale } from '../../shared/i18n/locale';
import { AuditLog } from '../identity/entities/audit-log.entity';
import type { AuthUserContext } from '../identity/identity.types';
import type { SaveCatalogTranslationDto } from './catalog-translations.dto';

const kinds = {
  category: {
    table: 'moc_category_translations',
    source: 'service_categories',
    description: true,
    visibility: 'p.is_published',
  },
  service: {
    table: 'moc_service_translations',
    source: 'services',
    description: true,
    visibility:
      'p.is_published AND EXISTS(SELECT 1 FROM public.service_categories c WHERE c.id=p.category_id AND c.is_published)',
  },
  variant: {
    table: 'moc_variant_translations',
    source: 'service_variants',
    description: false,
    visibility:
      'p.is_active AND EXISTS(SELECT 1 FROM public.services s JOIN public.service_categories c ON c.id=s.category_id WHERE s.id=p.service_id AND s.is_published AND c.is_published)',
  },
} as const;
type Kind = keyof typeof kinds;
type Source = { name: string; description: string | null };
export interface PublicCatalogTranslation {
  entityId: string;
  kind: Kind;
  requestedLocale: Locale;
  locale: Locale;
  name: string | null;
  description: string | null;
}
export interface AdminCatalogTranslation {
  entityId: string;
  kind: Kind;
  locale: Locale;
  source: Source;
  sourceFingerprint: string;
  version: number;
  translation: {
    name: string;
    description: string | null;
    status: 'DRAFT' | 'PUBLISHED';
    updatedAt: Date;
    stale: boolean;
  } | null;
}
export interface SavedCatalogTranslation {
  entityId: string;
  kind: Kind;
  locale: Locale;
  version: number;
  status: 'DRAFT' | 'PUBLISHED';
}
type Saved = {
  name: string;
  description: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  version: number;
  source_snapshot: Source;
  updated_at: Date;
};
export function catalogKind(value: string): Kind {
  if (!Object.hasOwn(kinds, value))
    throw new BadRequestException('Unsupported catalog translation kind.');
  return value as Kind;
}
export function catalogLocale(value: string, allowVietnamese = false): Locale {
  const locale = normalizeLocale(value);
  if (!locale || (!allowVietnamese && locale === 'vi'))
    throw new BadRequestException('Unsupported translation locale.');
  return locale;
}
export function sourceFingerprint(source: Source): string {
  return createHash('sha256')
    .update(JSON.stringify([source.name, source.description]))
    .digest('hex');
}
function requireAdmin(actor: AuthUserContext): void {
  if (!actor.roles.includes('SUPER_ADMIN')) throw new ForbiddenException('Super Admin required.');
}
@Injectable()
export class CatalogTranslationsService {
  constructor(private readonly db: DataSource) {}

  private async source(
    manager: EntityManager,
    kind: Kind,
    id: string,
    publicOnly: boolean,
    lock = false,
  ): Promise<Source> {
    const config = kinds[kind];
    const [row] = await manager.query<Source[]>(
      `SELECT p.name, ${config.description ? 'p.description' : 'NULL::text'} AS description
      FROM public.${config.source} p WHERE p.id=$1 ${publicOnly ? 'AND ' + config.visibility : ''} ${lock ? 'FOR UPDATE OF p' : ''}`,
      [id],
    );
    if (!row) throw new NotFoundException('Catalog item not found.');
    return row;
  }

  private async saved(
    manager: EntityManager,
    kind: Kind,
    id: string,
    locale: Locale,
  ): Promise<Saved | undefined> {
    const [row] = await manager.query<Saved[]>(
      `SELECT name,description,status,version,source_snapshot,updated_at
      FROM public.${kinds[kind].table} WHERE entity_id=$1 AND locale=$2`,
      [id, locale],
    );
    return row;
  }

  async publicDetail(
    rawKind: string,
    id: string,
    rawLocale: string,
  ): Promise<PublicCatalogTranslation> {
    const kind = catalogKind(rawKind),
      locale = catalogLocale(rawLocale, true),
      config = kinds[kind];
    // One statement / one MVCC snapshot: no stale translation can escape a concurrent source edit.
    const [row] = await this.db.query<
      (Source & {
        localized_name: string | null;
        localized_description: string | null;
        translated: boolean;
      })[]
    >(
      `
      SELECT p.name, ${config.description ? 'p.description' : 'NULL::text'} AS description,
        t.name AS localized_name,t.description AS localized_description,(t.entity_id IS NOT NULL) AS translated
      FROM public.${config.source} p LEFT JOIN public.${config.table} t
      ON t.entity_id=p.id AND t.locale=$2 AND t.status='PUBLISHED'
      AND t.source_snapshot=jsonb_build_object('name',p.name,'description',${config.description ? 'p.description' : 'NULL::text'})
      WHERE p.id=$1 AND ${config.visibility}`,
      [id, locale],
    );
    if (!row) throw new NotFoundException('Catalog item not found.');
    return {
      entityId: id,
      kind,
      requestedLocale: locale,
      locale: row.translated ? locale : 'vi',
      name: row.translated ? row.localized_name : row.name,
      description: row.translated
        ? (row.localized_description ?? row.description)
        : row.description,
    };
  }

  async adminDetail(
    actor: AuthUserContext,
    rawKind: string,
    id: string,
    rawLocale: string,
  ): Promise<AdminCatalogTranslation> {
    requireAdmin(actor);
    const kind = catalogKind(rawKind),
      locale = catalogLocale(rawLocale);
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const source = await this.source(manager, kind, id, false);
      const saved = await this.saved(manager, kind, id, locale);
      return {
        entityId: id,
        kind,
        locale,
        source,
        sourceFingerprint: sourceFingerprint(source),
        version: saved?.version ?? 0,
        translation: saved
          ? {
              name: saved.name,
              description: saved.description,
              status: saved.status,
              updatedAt: saved.updated_at,
              stale: sourceFingerprint(saved.source_snapshot) !== sourceFingerprint(source),
            }
          : null,
      };
    });
  }

  async save(
    actor: AuthUserContext,
    rawKind: string,
    id: string,
    rawLocale: string,
    dto: SaveCatalogTranslationDto,
  ): Promise<SavedCatalogTranslation> {
    requireAdmin(actor);
    const kind = catalogKind(rawKind),
      locale = catalogLocale(rawLocale);
    const name = dto.name.trim(),
      description = dto.description?.trim() || null;
    if (!name || (!kinds[kind].description && description !== null))
      throw new BadRequestException('Invalid translation content.');
    return this.db.transaction(async (manager) => {
      const source = await this.source(manager, kind, id, false, true);
      const prior = await this.saved(manager, kind, id, locale);
      if (
        sourceFingerprint(source) !== dto.sourceFingerprint ||
        (prior?.version ?? 0) !== dto.expectedVersion
      )
        throw new ConflictException(
          'Translation or Vietnamese source changed. Reload before saving.',
        );
      const version = (prior?.version ?? 0) + 1;
      await manager.query(
        `INSERT INTO public.${kinds[kind].table}
        (entity_id,locale,name,description,source_snapshot,status,version,updated_by,updated_at,published_by,published_at)
        VALUES($1,$2,$3,$4,$5::jsonb,$6::varchar,$7,$8::uuid,clock_timestamp(),CASE WHEN $6::varchar='PUBLISHED' THEN $8::uuid END,CASE WHEN $6::varchar='PUBLISHED' THEN clock_timestamp() END)
        ON CONFLICT(entity_id,locale) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
        source_snapshot=EXCLUDED.source_snapshot,status=EXCLUDED.status,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,
        updated_at=EXCLUDED.updated_at,published_by=EXCLUDED.published_by,published_at=EXCLUDED.published_at`,
        [id, locale, name, description, JSON.stringify(source), dto.status, version, actor.id],
      );
      await manager.save(AuditLog, {
        event: 'catalog.translation.save',
        actorUserId: actor.id,
        targetUserId: null,
        metadata: { kind, entityId: id, locale, version, status: dto.status },
      });
      return { entityId: id, kind, locale, version, status: dto.status };
    });
  }
}
