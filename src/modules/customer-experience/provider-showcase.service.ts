import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { DataSource, type EntityManager } from 'typeorm';
import { AuditLog } from '../identity/entities/audit-log.entity';
import type { AuthUserContext } from '../identity/identity.types';
import { ProviderDisplayService } from '../provider-display/provider-display.service';
import {
  SHOWCASE_MEDIA_CONSENT,
  type ShowcaseHoursDto,
  type ShowcaseMediaDto,
  type UpdateShowcaseDto,
} from './provider-showcase.dto';

export interface KtvShowcase {
  version: number;
  headline: string;
  biography: string;
  scheduleNote: string;
  weeklyHours: ShowcaseHoursDto[];
  media: ShowcaseMediaDto[];
  updatedAt: string | null;
}

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

const initialShowcase = (): KtvShowcase => ({
  version: 0,
  headline: '',
  biography: '',
  scheduleNote: '',
  weeklyHours: [],
  media: [],
  updatedAt: null,
});

const metadataKey = (id: string): string => `mocmaria.ktv.showcase.v1.${id}`;
const videoLimit = 40 * 1024 * 1024;
const imageLimit = 8 * 1024 * 1024;

@Injectable()
export class ProviderShowcaseService {
  constructor(
    private readonly db: DataSource,
    private readonly display: ProviderDisplayService,
  ) {}

  private async provider(id: string): Promise<{ id: string; userId: string }> {
    const [row] = await this.db.query<{ id: string; userId: string }[]>(
      `SELECT p.id, p.user_id AS "userId" FROM provider_applications p
       JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND u.is_active`,
      [id],
    );
    if (!row) throw new NotFoundException('Không tìm thấy hồ sơ KTV.');
    return row;
  }

  private async ownerOrAdmin(actor: AuthUserContext, id: string): Promise<string> {
    const provider = await this.provider(id);
    if (actor.roles.includes('SUPER_ADMIN')) return provider.userId;
    if (
      actor.id !== provider.userId ||
      !actor.roles.some((role) => role === 'THERAPIST' || role === 'DOCTOR_CONSULTANT')
    ) {
      throw new ForbiddenException('Bạn chỉ có thể tùy chỉnh trang KTV của chính mình.');
    }
    return provider.userId;
  }

  private async read(manager: EntityManager, id: string): Promise<KtvShowcase> {
    const [row] = await manager.query<{ value: KtvShowcase }[]>(
      'SELECT value FROM app_metadata WHERE key=$1',
      [metadataKey(id)],
    );
    return row?.value ?? initialShowcase();
  }

  async publicDetail(id: string): Promise<KtvShowcase> {
    const snapshot = await this.display.publicDisplay();
    if (!snapshot.rows.some((row) => row.providerId === id && row.visible)) {
      throw new NotFoundException('Trang KTV không được công khai.');
    }
    return this.read(this.db.manager, id);
  }

  async editor(actor: AuthUserContext, id: string): Promise<KtvShowcase> {
    await this.ownerOrAdmin(actor, id);
    return this.read(this.db.manager, id);
  }

  private validateHours(rows: ShowcaseHoursDto[]): ShowcaseHoursDto[] {
    const result = rows.map((row) => ({ ...row }));
    for (const row of result) {
      if (
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startsAt) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.endsAt) ||
        row.startsAt >= row.endsAt
      ) {
        throw new BadRequestException('Giờ làm việc phải hợp lệ và giờ kết thúc sau giờ bắt đầu.');
      }
    }
    for (const [index, row] of result.entries()) {
      if (
        result.some(
          (other, otherIndex) =>
            index !== otherIndex &&
            other.weekday === row.weekday &&
            row.startsAt < other.endsAt &&
            row.endsAt > other.startsAt,
        )
      ) {
        throw new BadRequestException('Có khung giờ làm việc trùng nhau.');
      }
    }
    return result.sort((a, b) => a.weekday - b.weekday || a.startsAt.localeCompare(b.startsAt));
  }

  private storageSettings(): { endpoint: string; secret: string; cdn: string } {
    const zone = process.env['BUNNY_STORAGE_ZONE']?.trim();
    const secret = (
      process.env['BUNNY_STORAGE_ACCESS_KEY'] || process.env['BUNNY_STORAGE_API_KEY']
    )?.trim();
    const cdn = (process.env['BUNNY_CDN_BASE_URL'] || process.env['BUNNY_STORAGE_CDN_URL'])?.trim();
    const region = process.env['BUNNY_STORAGE_REGION']?.trim() || 'sg';
    if (
      !zone ||
      !secret ||
      !cdn ||
      !/^https:\/\/[a-z0-9.-]+\/?$/i.test(cdn) ||
      !/^[a-z0-9_-]+$/i.test(zone) ||
      !/^[a-z0-9-]+$/i.test(region)
    ) {
      throw new ServiceUnavailableException('Chưa cấu hình CDN để tải ảnh và video KTV.');
    }
    return {
      endpoint: `https://${region}.storage.bunnycdn.com/${zone}`,
      secret,
      cdn: cdn.replace(/\/$/, ''),
    };
  }

  private verifyMedia(id: string, media: ShowcaseMediaDto[]): ShowcaseMediaDto[] {
    if (
      media.filter((item) => item.kind === 'IMAGE').length > 8 ||
      media.filter((item) => item.kind === 'VIDEO').length > 1
    ) {
      throw new BadRequestException('Tối đa 8 hình ảnh và 1 video giới thiệu.');
    }
    if (new Set(media.map((item) => item.id)).size !== media.length) {
      throw new BadRequestException('Ảnh/video không được lặp lại.');
    }
    const cdn = this.storageSettings().cdn;
    return media.map((item) => {
      const extension = item.kind === 'IMAGE' ? 'webp' : 'mp4';
      const expected = `${cdn}/moc-maria/provider-showcase/${id}/${item.id}.${extension}`;
      if (item.url !== expected) {
        throw new BadRequestException('Chỉ sử dụng ảnh/video tải lên CDN của hồ sơ này.');
      }
      return { id: item.id, kind: item.kind, url: item.url, caption: (item.caption ?? '').trim() };
    });
  }

  async update(actor: AuthUserContext, id: string, dto: UpdateShowcaseDto): Promise<KtvShowcase> {
    const targetUserId = await this.ownerOrAdmin(actor, id);
    const weeklyHours = this.validateHours(dto.weeklyHours);
    const media = dto.media.length ? this.verifyMedia(id, dto.media) : [];
    return this.db.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        metadataKey(id),
      ]);
      const old = await this.read(manager, id);
      if (old.version !== dto.expectedVersion) {
        throw new ConflictException('Trang đã được chỉnh sửa ở nơi khác. Tải lại trước khi lưu.');
      }
      const saved: KtvShowcase = {
        version: old.version + 1,
        headline: dto.headline.trim(),
        biography: dto.biography.trim(),
        scheduleNote: dto.scheduleNote.trim(),
        weeklyHours,
        media,
        updatedAt: new Date().toISOString(),
      };
      await manager.query(
        `INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=clock_timestamp()`,
        [metadataKey(id), JSON.stringify(saved)],
      );
      await manager.save(AuditLog, {
        event: 'provider.showcase.updated',
        actorUserId: actor.id,
        targetUserId,
        metadata: {
          providerId: id,
          version: saved.version,
          imageCount: media.filter((item) => item.kind === 'IMAGE').length,
          videoCount: media.filter((item) => item.kind === 'VIDEO').length,
          weeklyHourCount: weeklyHours.length,
        },
      });
      return saved;
    });
  }

  async upload(
    actor: AuthUserContext,
    id: string,
    file: UploadFile | undefined,
    consentVersion: string | undefined,
  ): Promise<ShowcaseMediaDto> {
    const targetUserId = await this.ownerOrAdmin(actor, id);
    if (consentVersion !== SHOWCASE_MEDIA_CONSENT) {
      throw new BadRequestException('Cần xác nhận quyền sử dụng và công khai ảnh/video.');
    }
    if (!file?.buffer || !file.size) throw new BadRequestException('Vui lòng chọn một tệp.');
    const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    const isVideo = file.mimetype === 'video/mp4';
    if (!isImage && !isVideo) {
      throw new BadRequestException('Chỉ chấp nhận JPG, PNG, WebP hoặc video MP4.');
    }
    if (file.size > (isImage ? imageLimit : videoLimit)) {
      throw new BadRequestException(isImage ? 'Hình ảnh tối đa 8 MB.' : 'Video MP4 tối đa 40 MB.');
    }
    let body: Buffer = file.buffer;
    if (isImage) {
      try {
        const image = sharp(file.buffer, { limitInputPixels: 24_000_000 });
        const info = await image.metadata();
        if (
          !info.width ||
          !info.height ||
          info.width < 240 ||
          info.height < 240 ||
          !['jpeg', 'png', 'webp'].includes(info.format || '')
        )
          throw new Error('invalid image');
        body = await image
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toBuffer();
      } catch {
        throw new BadRequestException('Ảnh không hợp lệ hoặc kích thước quá nhỏ.');
      }
    } else if (file.buffer.length < 16 || file.buffer.toString('ascii', 4, 8) !== 'ftyp') {
      throw new BadRequestException(
        'Video phải là tệp MP4 hợp lệ, khuyến nghị H.264/AAC cho iPhone.',
      );
    }

    const settings = this.storageSettings();
    const assetId = randomUUID();
    const kind = isImage ? 'IMAGE' : 'VIDEO';
    const suffix = isImage ? 'webp' : 'mp4';
    const path = `moc-maria/provider-showcase/${id}/${assetId}.${suffix}`;
    let response: Response;
    try {
      response = await fetch(`${settings.endpoint}/${path}`, {
        method: 'PUT',
        headers: {
          AccessKey: settings.secret,
          'Content-Type': isImage ? 'image/webp' : 'video/mp4',
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      throw new BadGatewayException('Không thể kết nối CDN. Vui lòng thử lại.');
    }
    if (!response.ok) throw new BadGatewayException('CDN chưa nhận được tệp.');
    await this.db.manager.save(AuditLog, {
      event: 'provider.showcase.media_uploaded',
      actorUserId: actor.id,
      targetUserId,
      metadata: { providerId: id, assetId, kind, bytes: body.length },
    });
    return { id: assetId, kind, url: `${settings.cdn}/${path}`, caption: '' };
  }
}
