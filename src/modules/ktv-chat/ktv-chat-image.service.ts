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
    if (!file?.buffer || !file.size || file.size > 12 * 1024 * 1024)
      throw new BadRequestException('Ảnh chat phải có dung lượng tối đa 12 MB.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
      throw new BadRequestException('Chỉ cho phép ảnh JPG, PNG và WebP.');

    // Read only the header here so excessive dimensions get a specific error.
    const info = await sharp(file.buffer, { limitInputPixels: false })
      .metadata()
      .catch(() => {
        throw new BadRequestException('Không đọc được ảnh. Hãy chọn lại ảnh JPG, PNG hoặc WebP.');
      });
    if (!info.width || !info.height || !['jpeg', 'png', 'webp'].includes(info.format || ''))
      throw new BadRequestException('Nội dung file không phải ảnh JPG, PNG hoặc WebP.');
    if (info.width * info.height > 24_000_000)
      throw new BadRequestException('Ảnh vượt 24 megapixel. Hãy thu nhỏ ảnh rồi gửi lại.');

    // Some Android camera encoders include recoverable JPEG/WebP warnings.
    // Try strict decoding first, then a bounded tolerant decode if needed.
    // Invalid headers are still rejected by metadata() above; dimensions
    // remain limited to 24 megapixels for both paths.
    const encode = async (
      edge: number,
      quality: number,
      failOn: 'error' | 'none',
    ): Promise<Buffer> =>
      sharp(file.buffer, { limitInputPixels: 24_000_000, failOn })
        .rotate()
        .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 3 })
        .toBuffer();
    const variants: Array<[number, number]> = [
      [2048, 82],
      [1600, 76],
      [1280, 68],
      [960, 60],
    ];
    let optimized: Buffer | null = null;
    for (const tolerance of ['error', 'none'] as const) {
      for (const [edge, quality] of variants) {
        try {
          const buffer = await encode(edge, quality, tolerance);
          if (!optimized || buffer.length < optimized.length) optimized = buffer;
          if (buffer.length <= 2 * 1024 * 1024) break;
        } catch {
          // Fallback to a smaller size or tolerant JPEG decode.
        }
      }
      if (optimized && optimized.length <= 2 * 1024 * 1024) break;
    }
    if (!optimized)
      throw new BadRequestException(
        'Không xử lý được dữ liệu ảnh. Hãy lưu lại ảnh dưới dạng JPG rồi thử gửi.',
      );
    if (optimized.length > 2 * 1024 * 1024)
      throw new BadRequestException('Ảnh vẫn quá nặng sau khi nén. Hãy chọn ảnh nhẹ hơn.');

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
