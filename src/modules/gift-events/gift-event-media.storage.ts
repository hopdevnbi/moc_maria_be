import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

export type GiftMediaFile = { buffer: Buffer; size: number; mimetype: string };
@Injectable()
export class GiftEventMediaStorage {
  async upload(
    eventId: string,
    file?: GiftMediaFile,
  ): Promise<{ url: string; mimeType: 'image/webp'; width: 800; height: 800; bytes: number }> {
    if (!file?.buffer || file.size <= 0 || file.size > 5 * 1024 * 1024)
      throw new BadRequestException('Ảnh quà tối đa 5MB.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
      throw new BadRequestException('Chỉ chấp nhận JPEG, PNG và WebP.');
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
      !/^[-a-z0-9_]+$/i.test(zone) ||
      !/^[-a-z0-9]+$/i.test(region)
    )
      throw new ServiceUnavailableException('Bunny CDN của Mộc Maria chưa cấu hình.');
    let optimized: Buffer;
    try {
      const pipeline = sharp(file.buffer, { limitInputPixels: 20_000_000 });
      const meta = await pipeline.metadata();
      if (
        !meta.width ||
        !meta.height ||
        meta.width < 150 ||
        meta.height < 150 ||
        !['jpeg', 'png', 'webp'].includes(meta.format || '')
      )
        throw new Error('Invalid format');
      optimized = await pipeline
        .rotate()
        .resize(800, 800, { fit: 'cover', position: 'attention' })
        .webp({ quality: 78, effort: 5 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Ảnh không hợp lệ; vui lòng đổi ảnh khác.');
    }
    const path = `moc-maria/gift-events/${eventId}/${randomUUID()}.webp`;
    let response: Response;
    try {
      response = await fetch(`https://${region}.storage.bunnycdn.com/${zone}/${path}`, {
        method: 'PUT',
        headers: { AccessKey: secret, 'Content-Type': 'image/webp' },
        body: new Uint8Array(optimized),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new BadGatewayException('Không thể kết nối kho ảnh.');
    }
    if (!response.ok) throw new BadGatewayException('Lưu ảnh CDN không thành công.');
    return {
      url: cdn.replace(/\/$/, '') + '/' + path,
      mimeType: 'image/webp',
      width: 800,
      height: 800,
      bytes: optimized.byteLength,
    };
  }
}
