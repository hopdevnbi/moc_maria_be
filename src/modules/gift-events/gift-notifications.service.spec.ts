import { giftNoticeText, GiftNotificationsService } from './gift-notifications.service';
import type { EntityManager, DataSource } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import type { ZaloAlertsService } from '../zalo-alerts/zalo-alerts.service';
import type { AdminAlertsService } from '../admin-alerts/admin-alerts.service';

const notice = {
  rewardId: '22222222-2222-4222-8222-222222222222',
  eventId: '33333333-3333-4333-8333-333333333333',
  eventTitle: 'Tháng 11 tri ân',
  customerName: 'Khách thử',
  prizeName: 'Voucher giảm 20%',
  issuedAt: '2026-11-01T00:00:00Z',
  expiresAt: '2026-12-01T00:00:00Z',
};

describe('V06 durable gift notification', () => {
  it('excludes redemption PIN/token and sanitizes free text', () => {
    const msg = giftNoticeText({ ...notice, customerName: 'Khách\r\nX-Header: wrong' });
    expect(msg).toContain('Voucher giảm 20%');
    expect(msg).toContain('/quan-tri/su-kien/voucher');
    expect(msg).not.toContain('\r');
    expect(msg).not.toContain('123456');
  });
  it('writes both channel notifications in the caller transaction with stable reward keys', async () => {
    const captured: Array<[string, unknown[]]> = [];
    const query = jest.fn((sql: string, params: unknown[]) => {
      captured.push([sql, params]);
      return Promise.resolve([]);
    });
    const service = new GiftNotificationsService(
      {} as DataSource,
      {} as ConfigService,
      {} as ZaloAlertsService,
      {} as AdminAlertsService,
    );
    await service.enqueue({ query } as unknown as EntityManager, notice);
    expect(query).toHaveBeenCalledTimes(2);
    expect(captured[0][1][0]).toBe('mocmaria.gift.notify.zalo.' + notice.rewardId);
    expect(captured[1][1][0]).toBe('mocmaria.gift.notify.email.' + notice.rewardId);
    expect(captured[0][0]).toContain('ON CONFLICT(key) DO NOTHING');
  });
});
