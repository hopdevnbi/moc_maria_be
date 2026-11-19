import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import type { Locale } from '../../shared/i18n/locale';
import { ProviderDisplayService } from '../provider-display/provider-display.service';
import { AuditLog } from '../identity/entities/audit-log.entity';
import type { AuthUserContext } from '../identity/identity.types';
import { catalogLocale } from './catalog-translations.service';
import type { SaveShowcaseTranslationDto } from './provider-showcase-translations.dto';

export interface ShowcaseText {
  headline: string;
  biography: string;
  scheduleNote: string;
}
type Saved = ShowcaseText & {
  source_snapshot: ShowcaseText;
  status: 'DRAFT' | 'PUBLISHED';
  version: number;
  updated_at: Date;
};
interface ShowcaseAdmin {
  providerId: string;
  locale: Locale;
  source: ShowcaseText;
  sourceFingerprint: string;
  version: number;
  translation:
    (ShowcaseText & { status: 'DRAFT' | 'PUBLISHED'; updatedAt: Date; stale: boolean }) | null;
}
interface ShowcasePublic {
  providerId: string;
  requestedLocale: Locale;
  locale: Locale;
  translation: ShowcaseText | null;
}
const key = (id: string): string => 'mocmaria.ktv.showcase.v1.' + id;
export function showcaseFingerprint(s: ShowcaseText): string {
  return createHash('sha256')
    .update(JSON.stringify([s.headline, s.biography, s.scheduleNote]))
    .digest('hex');
}
function admin(actor: AuthUserContext): void {
  if (!actor.roles.includes('SUPER_ADMIN')) throw new ForbiddenException('Super Admin required.');
}
function text(value: unknown): ShowcaseText {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<ShowcaseText>;
  return {
    headline: typeof v.headline === 'string' ? v.headline : '',
    biography: typeof v.biography === 'string' ? v.biography : '',
    scheduleNote: typeof v.scheduleNote === 'string' ? v.scheduleNote : '',
  };
}
@Injectable()
export class ProviderShowcaseTranslationsService {
  constructor(
    private readonly db: DataSource,
    private readonly display: ProviderDisplayService,
  ) {}
  private async source(manager: EntityManager, id: string): Promise<ShowcaseText> {
    const [row] = await manager.query<{ value: unknown }[]>(
      `SELECT m.value FROM public.provider_applications p JOIN public.users u ON u.id=p.user_id AND u.is_active LEFT JOIN public.app_metadata m ON m.key=$2 WHERE p.id=$1`,
      [id, key(id)],
    );
    if (!row) throw new NotFoundException('Provider not found.');
    return text(row.value);
  }
  private async saved(
    manager: EntityManager,
    id: string,
    locale: Locale,
  ): Promise<Saved | undefined> {
    const [row] = await manager.query<Saved[]>(
      `SELECT headline,biography,schedule_note AS "scheduleNote",status,version,source_snapshot,updated_at FROM public.moc_provider_showcase_translations WHERE provider_id=$1 AND locale=$2`,
      [id, locale],
    );
    return row;
  }
  async publicDetail(id: string, rawLocale: string): Promise<ShowcasePublic> {
    const locale = catalogLocale(rawLocale, true);
    const snapshot = await this.display.publicDisplay();
    if (!snapshot.rows.some((row) => row.providerId === id && row.visible))
      throw new NotFoundException('Provider not public.');
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const source = await this.source(manager, id);
      const saved = locale === 'vi' ? undefined : await this.saved(manager, id, locale);
      const eligible =
        saved?.status === 'PUBLISHED' &&
        showcaseFingerprint(saved.source_snapshot) === showcaseFingerprint(source);
      return {
        providerId: id,
        requestedLocale: locale,
        locale: eligible ? locale : 'vi',
        translation: eligible && saved ? text(saved) : null,
      };
    });
  }
  async adminDetail(actor: AuthUserContext, id: string, rawLocale: string): Promise<ShowcaseAdmin> {
    admin(actor);
    const locale = catalogLocale(rawLocale);
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const source = await this.source(manager, id),
        saved = await this.saved(manager, id, locale);
      return {
        providerId: id,
        locale,
        source,
        sourceFingerprint: showcaseFingerprint(source),
        version: saved?.version ?? 0,
        translation: saved
          ? {
              ...text(saved),
              status: saved.status,
              updatedAt: saved.updated_at,
              stale: showcaseFingerprint(saved.source_snapshot) !== showcaseFingerprint(source),
            }
          : null,
      };
    });
  }
  async save(
    actor: AuthUserContext,
    id: string,
    rawLocale: string,
    dto: SaveShowcaseTranslationDto,
  ): Promise<{
    providerId: string;
    locale: Locale;
    version: number;
    status: 'DRAFT' | 'PUBLISHED';
  }> {
    admin(actor);
    const locale = catalogLocale(rawLocale);
    const value = {
      headline: dto.headline.trim(),
      biography: dto.biography.trim(),
      scheduleNote: dto.scheduleNote.trim(),
    };
    if (!Object.values(value).some(Boolean)) throw new BadRequestException('Empty translation.');
    return this.db.transaction(async (manager) => {
      // Same advisory lock as the existing showcase editor; no write to the source.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key(id)]);
      const source = await this.source(manager, id),
        prior = await this.saved(manager, id, locale);
      if (
        showcaseFingerprint(source) !== dto.sourceFingerprint ||
        (prior?.version ?? 0) !== dto.expectedVersion
      )
        throw new ConflictException('Source or translation changed.');
      for (const field of ['headline', 'biography', 'scheduleNote'] as const)
        if (value[field] && !source[field].trim())
          throw new BadRequestException('Translate only fields with original source content.');
      const version = (prior?.version ?? 0) + 1;
      await manager.query(
        `INSERT INTO public.moc_provider_showcase_translations(provider_id,locale,headline,biography,schedule_note,source_snapshot,status,version,updated_by,published_by,published_at)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::varchar,$8,$9::uuid,CASE WHEN $7::varchar='PUBLISHED' THEN $9::uuid END,CASE WHEN $7::varchar='PUBLISHED' THEN clock_timestamp() END)
      ON CONFLICT(provider_id,locale) DO UPDATE SET headline=EXCLUDED.headline,biography=EXCLUDED.biography,schedule_note=EXCLUDED.schedule_note,source_snapshot=EXCLUDED.source_snapshot,status=EXCLUDED.status,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp(),published_by=EXCLUDED.published_by,published_at=EXCLUDED.published_at`,
        [
          id,
          locale,
          value.headline,
          value.biography,
          value.scheduleNote,
          JSON.stringify(source),
          dto.status,
          version,
          actor.id,
        ],
      );
      await manager.save(AuditLog, {
        event: 'provider.showcase.translation.save',
        actorUserId: actor.id,
        targetUserId: null,
        metadata: { providerId: id, locale, version, status: dto.status },
      });
      return { providerId: id, locale, version, status: dto.status };
    });
  }
}
