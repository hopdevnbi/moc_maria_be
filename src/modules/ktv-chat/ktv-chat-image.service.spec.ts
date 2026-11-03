import sharp from 'sharp';
import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvChatService } from './ktv-chat.service';
import { KtvChatImageService } from './ktv-chat-image.service';

describe('KTV chat image CDN', () => {
  const actor = { id: '11111111-1111-4111-8111-111111111111' } as AuthUserContext;
  const thread = '22222222-2222-4222-8222-222222222222';
  const env = { ...process.env };
  const oldFetch = global.fetch;
  const authorize = jest.fn<Promise<void>, [AuthUserContext, string, string?]>();
  const query = jest.fn<Promise<unknown[]>, [string, unknown[]]>();
  const service = new KtvChatImageService(
    { query } as unknown as DataSource,
    { assertImageUploadPermission: authorize } as unknown as KtvChatService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    authorize.mockResolvedValue(undefined);
    query.mockResolvedValue([]);
    process.env['BUNNY_STORAGE_ZONE'] = 'test-zone';
    process.env['BUNNY_STORAGE_API_KEY'] = 'fake-secret';
    process.env['BUNNY_STORAGE_CDN_URL'] = 'https://cdn.example.test';
    delete process.env['BUNNY_STORAGE_ACCESS_KEY'];
    delete process.env['BUNNY_CDN_BASE_URL'];
    global.fetch = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue({ ok: true } as Response);
  });
  afterAll(() => {
    process.env = env;
    global.fetch = oldFetch;
  });
  it('rejects non-image files and forged image content', async () => {
    await expect(
      service.upload(actor, thread, {
        buffer: Buffer.from('abc'),
        size: 3,
        mimetype: 'application/pdf',
      }),
    ).rejects.toThrow();
    await expect(
      service.upload(actor, thread, { buffer: Buffer.from('abc'), size: 3, mimetype: 'image/png' }),
    ).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('rejects an image above the pixel limit before uploading', async () => {
    const buffer = await sharp({
      create: { width: 5000, height: 5000, channels: 3, background: 'white' },
    })
      .jpeg()
      .toBuffer();
    await expect(
      service.upload(actor, thread, { buffer, size: buffer.length, mimetype: 'image/jpeg' }),
    ).rejects.toThrow('Ảnh vượt 24 megapixel');
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('resizes actual PNG and stores WebP under chat-attachments', async () => {
    const buffer = await sharp({
      create: { width: 2400, height: 1500, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    const res = await service.upload(actor, thread, {
      buffer,
      size: buffer.length,
      mimetype: 'image/png',
    });
    expect(res.url).toContain(`/moc-maria/chat-attachments/${thread}/`);
    expect(res.url).toMatch(/\.webp$/);
    const uploaded = (
      global.fetch as jest.Mock<Promise<Response>, [RequestInfo | URL, RequestInit?]>
    ).mock.calls[0]?.[1]?.body;
    const converted = Buffer.from(uploaded as Uint8Array);
    expect(converted.length).toBeLessThanOrEqual(1024 * 1024);
    expect((await sharp(converted).metadata()).width).toBeLessThanOrEqual(2048);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('accepts a mobile camera JPEG upload larger than the old 5 MB cap', async () => {
    const jpg = await sharp({
      create: { width: 1800, height: 1200, channels: 3, background: '#d8eee1' },
    })
      .jpeg()
      .toBuffer();
    // Some cameras append extra EXIF or trailer bytes. Keep the original JPEG
    // valid while exercising the larger request limit and tolerant decoder.
    const cameraBuffer = Buffer.concat([jpg, Buffer.alloc(6 * 1024 * 1024)]);
    const output = await service.upload(actor, thread, {
      buffer: cameraBuffer,
      size: cameraBuffer.length,
      mimetype: 'image/jpeg',
    });
    expect(output.url).toMatch(/\.webp$/);
    const uploaded = (
      global.fetch as jest.Mock<Promise<Response>, [RequestInfo | URL, RequestInit?]>
    ).mock.calls[0]?.[1]?.body;
    const encoded = Buffer.from(uploaded as Uint8Array);
    expect((await sharp(encoded).metadata()).format).toBe('webp');
    expect(encoded.length).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('rejects image uploads beyond 12 MB before decoding or contacting Bunny', async () => {
    await expect(
      service.upload(actor, thread, {
        buffer: Buffer.from('image'),
        size: 12 * 1024 * 1024 + 1,
        mimetype: 'image/jpeg',
      }),
    ).rejects.toThrow('12 MB');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
