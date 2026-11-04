import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { StaffCheckIn } from './entities/staff-check-in.entity';

export type AttendanceImageFile = { buffer: Buffer; size: number; mimetype: string };

@Injectable()
export class StaffAttendanceStorage {
  async upload(checkIn: StaffCheckIn, file?: AttendanceImageFile): Promise<string> {
    if (!file?.buffer || file.size <= 0 || file.size > 5 * 1024 * 1024)
      throw new BadRequestException('Ảnh selfie tối đa 5 MB.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
      throw new BadRequestException('Chỉ chấp nhận ảnh JPG, PNG và WebP.');
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
      throw new ServiceUnavailableException('Bunny CDN chưa được cấu hình.');
    let optimized: Buffer;
    try {
      const pipeline = sharp(file.buffer, { limitInputPixels: 20_000_000 });
      const meta = await pipeline.metadata();
      if (!meta.width || !meta.height || !['jpeg', 'png', 'webp'].includes(meta.format ?? ''))
        throw new Error('Invalid image');
      optimized = await pipeline
        .rotate()
        .resize(1440, 1440, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78, effort: 4 })
        .toBuffer();
      if (optimized.length > 2 * 1024 * 1024) throw new Error('Image too large');
    } catch {
      throw new BadRequestException('Không xử lý được ảnh selfie. Vui lòng chọn ảnh khác.');
    }
    // Sharp strips EXIF, including sensitive embedded camera coordinates.
    const path = `moc-maria/staff-attendance/${checkIn.localDate}/${checkIn.id}/${randomUUID()}.webp`;
    let response: Response;
    try {
      response = await fetch(`https://${region}.storage.bunnycdn.com/${zone}/${path}`, {
        method: 'PUT',
        headers: { AccessKey: secret, 'Content-Type': 'image/webp' },
        body: new Uint8Array(optimized),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new BadGatewayException('Không thể tải ảnh selfie lên CDN.');
    }
    if (!response.ok) throw new BadGatewayException('Bunny CDN không nhận ảnh selfie.');
    return `${cdn.replace(/\/$/, '')}/${path}`;
  }
}
