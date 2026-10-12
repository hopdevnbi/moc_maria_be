import { digestText, nextDigestAt, DigestSettings } from './chat-digest.service';
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
