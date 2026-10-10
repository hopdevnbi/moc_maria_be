import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import sharp from 'sharp';
import { StaffAvatarStorage } from './staff-avatar-storage';

describe('StaffAvatarStorage', () => {
  const saved = { ...process.env };
  const originalFetch = global.fetch;
  const storage = new StaffAvatarStorage();

  afterEach(() => {
    process.env = { ...saved };
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects files without valid image media type', async () => {
    await expect(
      storage.upload('user-1', {
        buffer: Buffer.from('bad'),
        size: 3,
        mimetype: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never stores images without a configured CDN and access key', async () => {
    delete process.env['BUNNY_STORAGE_ZONE'];
    delete process.env['BUNNY_STORAGE_ACCESS_KEY'];
    delete process.env['BUNNY_STORAGE_API_KEY'];
    await expect(
      storage.upload('user-1', {
        buffer: Buffer.from([0xff, 0xd8]),
        size: 2,
        mimetype: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('converts a valid image into a small WebP and writes only to owner-scoped storage', async () => {
    process.env['BUNNY_STORAGE_ZONE'] = 'sample-zone';
    process.env['BUNNY_STORAGE_ACCESS_KEY'] = 'test-secret';
    process.env['BUNNY_CDN_BASE_URL'] = 'https://cdn.example.com';
    const data = await sharp({
      create: { width: 512, height: 512, channels: 3, background: { r: 50, g: 90, b: 110 } },
    })
      .png()
      .toBuffer();
    const fakeFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fakeFetch as typeof fetch;
    const url = await storage.upload('11111111-1111-4111-8111-111111111111', {
      buffer: data,
      mimetype: 'image/png',
      size: data.length,
    });
    expect(url).toMatch(
      /^https:\/\/cdn\.example\.com\/moc-maria\/staff-avatars\/11111111-1111-4111-8111-111111111111\/[a-f0-9-]+\.webp$/,
    );
    const [endpoint, options] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toContain('sg.storage.bunnycdn.com/sample-zone/');
    expect((options.headers as Record<string, string>)['AccessKey']).toBe('test-secret');
    const body = Buffer.from(options.body as Uint8Array);
    expect(body.toString('ascii', 0, 4)).toBe('RIFF');
    expect(body.length).toBeLessThan(data.length);
  });
});
