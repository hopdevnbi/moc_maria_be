import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import sharp from 'sharp';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvChatService } from './ktv-chat.service';
import { chatImageUploadKey } from './ktv-chat-image.keys';

@Injectable()
export class KtvChatImageService {
  constructor(
    private readonly db: DataSource,
    private readonly chat: KtvChatService,
  ) {}

  async upload(
    actor: AuthUserContext,
    threadId: string,
    file?: { buffer: Buffer; mimetype: string; size: number },
    unlock?: string,
  ): Promise<{ url: string }> {
    // Permission checks precede CPU-intensive image decoding and network uploads.
    await this.chat.assertImageUploadPermission(actor, threadId, unlock);
    if (!file?.buffer || !file.size || file.size > 5 * 1024 * 1024)
      throw new BadRequestException('Ảnh chat phải có dung lượng tối đa 5 MB.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
      throw new BadRequestException('Chỉ cho phép ảnh JPG, PNG và WebP.');

    let optimized: Buffer;
    try {
      const image = sharp(file.buffer, { limitInputPixels: 24_000_000, failOn: 'error' });
      const info = await image.metadata();
      if (!info.width || !info.height || !['jpeg', 'png', 'webp'].includes(info.format || ''))
        throw new Error('Invalid image');
      optimized = await image
        .rotate()
        .resize({
          width: 2048,
          height: 2048,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
      if (optimized.length > 1024 * 1024) {
        optimized = await sharp(file.buffer, { limitInputPixels: 24_000_000 })
          .rotate()
          .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 72 })
          .toBuffer();
      }
      if (optimized.length > 1024 * 1024) {
        optimized = await sharp(file.buffer, { limitInputPixels: 24_000_000 })
          .rotate()
          .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 64 })
          .toBuffer();
      }
      if (optimized.length > 1024 * 1024) throw new Error('Image too large after optimization');
    } catch {
      throw new BadRequestException('Ảnh không hợp lệ hoặc quá phức tạp. Hãy chọn ảnh khác.');
    }

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
    )
      throw new ServiceUnavailableException('CDN lưu ảnh chưa được cấu hình.');

    const imageId = randomUUID();
    const path = `moc-maria/chat-attachments/${threadId}/${imageId}.webp`;
    let result: Response;
    try {
      result = await fetch(`https://${region}.storage.bunnycdn.com/${zone}/${path}`, {
        method: 'PUT',
        headers: { AccessKey: secret, 'Content-Type': 'image/webp' },
        body: new Uint8Array(optimized),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new BadGatewayException('Không tải được ảnh lên CDN.');
    }
    if (!result.ok) throw new BadGatewayException('CDN từ chối ảnh.');
    const url = `${cdn.replace(/\/$/, '')}/${path}`;
    await this.db.query(`INSERT INTO app_metadata(key,value) VALUES($1,$2::jsonb)`, [
      chatImageUploadKey(imageId),
      JSON.stringify({ threadId, userId: actor.id, url, createdAt: Date.now(), used: false }),
    ]);
    return { url };
  }
}
