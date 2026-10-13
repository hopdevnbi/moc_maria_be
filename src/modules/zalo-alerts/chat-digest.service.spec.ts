import { ChatDigestService, digestText, nextDigestAt, DigestSettings } from './chat-digest.service';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { ZaloAlertsService } from './zalo-alerts.service';
const settings: DigestSettings = {
  enabled: true,
  mode: 'daily',
  hour: 9,
  intervalHours: 1,
  zalo: true,
  email: true,
};
describe('Chat digest schedule', () => {
  it('uses Vietnam time before and after the daily cutoff, including month rollover', () => {
    expect(nextDigestAt(settings, new Date('2026-10-12T01:59:00Z')).toISOString()).toBe(
      '2026-10-12T02:00:00.000Z',
    );
    expect(nextDigestAt(settings, new Date('2026-10-31T02:00:00Z')).toISOString()).toBe(
      '2026-11-01T02:00:00.000Z',
    );
  });
  it('schedules configurable intervals from the saved time', () => {
    expect(
      nextDigestAt(
        { ...settings, mode: 'interval' },
        new Date('2026-10-12T03:17:00Z'),
      ).toISOString(),
    ).toBe('2026-10-12T04:17:00.000Z');
  });
  it('renders one bounded summary per thread with counts and no message contents', () => {
    const text = digestText({
      id: 'thread',
      customer_name: 'Khách\nFake',
      provider_name: 'KTV',
      customer_messages: 12,
      provider_messages: 3,
      last_seq: '42',
      last_at: '2026-10-12T03:17:00Z',
    });
    expect(text).toContain('Tin mới từ khách: 12');
    expect(text).toContain('Tin mới từ KTV: 3');
    expect(text).toContain('Khách: Khách Fake');
    expect(text.length).toBeLessThan(2000);
  });
});

describe('Chat digest email sender and pending-report compatibility', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([undefined, '<html><body>Saved branded report</body></html>'])(
    'uses the dedicated sender and handles stored html=%s without changing retry identity',
    async (html) => {
      const query = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            key: 'mocmaria.chat.digest.email.existing',
            value: {
              recipient: 'admin@example.com',
              threadId: 'thread-existing',
              text: 'Khách: An\nTin mới từ khách: 2',
              attempts: 3,
              html,
            },
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      const config = new Map([
        ['QUEUE_SERVICE_URL', 'https://queue.test'],
        ['QUEUE_API_KEY', 'test-only'],
      ]);
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as typeof fetch;
      const service = new ChatDigestService(
        { query } as unknown as DataSource,
        { get: (key: string) => config.get(key) } as ConfigService,
        {} as ZaloAlertsService,
      );
      await service.drainEmail();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(options.body as string) as {
        data: { from: string; html: string; text: string };
        options: { jobId: string };
      };
      expect(payload.data.from).toBe('no-reply@mocmaria.com');
      expect(payload.options.jobId).toBe('mocmaria.chat.digest.email.existing');
      expect(payload.data.text).toBe('Khách: An\nTin mới từ khách: 2');
      expect(payload.data.html).toContain(html ? 'Saved branded report' : 'WELLNESS LOUNGE');
      expect(payload.data.html).not.toContain('giangxa.com');
      const [, updateValues] = query.mock.calls[2] as [string, [string, string, string]];
      expect(JSON.parse(updateValues[1])).toMatchObject({
        status: 'queued',
        attempts: 4,
      });
    },
  );
});
