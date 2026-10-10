import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

export interface ProfileAvatarFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Injectable()
export class StaffAvatarStorage {
  async upload(userId: string, file?: ProfileAvatarFile): Promise<string> {
    if (!file?.buffer || file.size <= 0 || file.size > 5 * 1024 * 1024)
      throw new BadRequestException('Avatar must be an image smaller than 5MB.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
      throw new BadRequestException('Only JPG, PNG, and WebP images are accepted.');

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
      throw new ServiceUnavailableException('Avatar CDN storage is not configured.');

    let optimized: Buffer;
    try {
      const image = sharp(file.buffer, { limitInputPixels: 20_000_000 });
      const metadata = await image.metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width < 100 ||
        metadata.height < 100 ||
        !['jpeg', 'png', 'webp'].includes(metadata.format || '')
      ) {
        throw new Error('invalid dimensions or format');
      }
      optimized = await image
        .rotate()
        .resize(384, 384, { fit: 'cover', position: 'attention' })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Invalid image content. Please choose another image.');
    }

    const path = 'moc-maria/staff-avatars/' + userId + '/' + randomUUID() + '.webp';
    const url = 'https://' + region + '.storage.bunnycdn.com/' + zone + '/' + path;
    let result: Response;
    try {
      result = await fetch(url, {
        method: 'PUT',
        headers: { AccessKey: secret, 'Content-Type': 'image/webp' },
        body: new Uint8Array(optimized),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new BadGatewayException('Cannot reach image storage. Try again later.');
    }
    if (!result.ok) throw new BadGatewayException('Image storage rejected the upload.');
    return cdn.replace(/\/$/, '') + '/' + path;
  }
}
