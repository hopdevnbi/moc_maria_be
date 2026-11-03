import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { alertText, ZaloAlertsService, type ZaloAlert } from './zalo-alerts.service';
import { STAFF_ZALO_BOTS, staffOutboxPrefix, ZaloKtvBotsService } from './zalo-ktv-bots.service';
import { ZaloHoanAlertsService } from './zalo-hoan-alerts.service';
import { ZaloLinhDanAlertsService } from './zalo-linh-dan-alerts.service';

describe('KTV Zalo bots keep customer contact information private', () => {
  const inquiry: ZaloAlert = {
    kind: 'inquiry',
    eventId: 'booking-123',
    customerName: 'Chị Mai',
    customerPhone: '0912345678',
    customerEmail: 'mai@example.com',
    providerName: 'Bác sĩ Tiến Mạnh',
    providerPhone: '0987654321',
    providerEmail: 'ktv@example.com',
    serviceName: 'Massage body',
  };

  const variables = new Map([
    ['NODE_ENV', 'test'],
    ['ZALO_BOT_TOKEN', 'primary-test-token'],
    ['ZALO_ADMIN_CHAT_IDS', 'admin-1'],
    ['ZALO_LINH_DAN_BOT_TOKEN', 'linh-dan-test-token'],
    ['ZALO_LINH_DAN_CHAT_IDS', 'dan-1'],
    ['ZALO_HOAN_BOT_TOKEN', 'hoan-test-token'],
    ['ZALO_HOAN_CHAT_IDS', 'hoan-1'],
    ['ZALO_TIEN_MANH_BOT_TOKEN', 'manh-test-token'],
    ['ZALO_TIEN_MANH_CHAT_IDS', 'manh-1,manh-1,bad/id'],
    ['ZALO_TUNG_BOT_TOKEN', 'tung-test-token'],
    ['ZALO_TUNG_CHAT_IDS', 'tung-1'],
    ['ZALO_NGUYET_BOT_TOKEN', 'nguyet-test-token'],
    ['ZALO_NGUYET_CHAT_IDS', 'nguyet-1'],
  ]);

  function setup(values = variables): {
    staff: ZaloKtvBotsService;
    main: ZaloAlertsService;
    query: jest.Mock<Promise<unknown[]>, [string, string[]]>;
    manager: EntityManager;
  } {
    const config = { get: (name: string): string | undefined => values.get(name) } as ConfigService;
    const query = jest.fn<Promise<unknown[]>, [string, string[]]>().mockResolvedValue([]);
    const db = { query } as unknown as DataSource;
    const staff = new ZaloKtvBotsService(db, config);
    const main = new ZaloAlertsService(
      db,
      config,
      new ZaloLinhDanAlertsService(db, config),
      new ZaloHoanAlertsService(db, config),
      staff,
    );
    jest.spyOn(main, 'configuredRecipients').mockResolvedValue(['admin-1']);
    return { staff, main, query, manager: { query } as unknown as EntityManager };
  }

  it('preserves full contact information for the three established admin bots', () => {
    const full = alertText(inquiry);
    expect(full).toContain('0912345678');
    expect(full).toContain('mai@example.com');
    expect(full).toContain('0987654321');
    expect(full).toContain('ktv@example.com');
  });

  it('removes only customer contact fields from the staff booking payload', () => {
    const text = alertText(inquiry, { includeCustomerContacts: false });
    expect(text).not.toContain('0912345678');
    expect(text).not.toContain('mai@example.com');
    expect(text).toContain('Bác sĩ Tiến Mạnh');
    expect(text).toContain('Massage body');
    expect(text).toContain('0987654321');
    expect(text).toContain('ktv@example.com');
    expect(text).toContain('booking-123');
  });

  it('redacts contacts inside customer-authored chat and display names, without changing the admin body', () => {
    const alert: ZaloAlert = {
      ...inquiry,
      kind: 'chat',
      senderRole: 'customer',
      customerName: 'Mai 0912345678 mai@example.com',
      messageBody: 'Nhắn tôi +84987654321 hoặc mai@example.com, xin cảm ơn',
    };
    const original = alertText(alert);
    const staffText = alertText(alert, { includeCustomerContacts: false });
    expect(original).toContain('mai@example.com');
    expect(original).toContain('+84987654321');
    expect(staffText).not.toContain('0912345678');
    expect(staffText).not.toContain('+84987654321');
    expect(staffText).not.toContain('mai@example.com');
    expect(staffText).toContain('[SĐT ẩn]');
    expect(staffText).toContain('[email ẩn]');
    expect(staffText).toContain('xin cảm ơn');
    expect(staffText).toContain('Mã tin: booking-123');
  });

  it('continues to conceal messages in password-protected chats', () => {
    const text = alertText(
      {
        ...inquiry,
        kind: 'chat',
        senderRole: 'customer',
        messageBody: 'secret 0912345678',
        chatPrivacyProtected: true,
      },
      { includeCustomerContacts: false },
    );
    expect(text).not.toContain('secret');
    expect(text).not.toContain('0912345678');
  });

  it('fans out both booking and chat events to six isolated bot outboxes', async () => {
    const { main, manager, query } = setup();
    await main.enqueue(manager, inquiry);
    await main.enqueue(manager, {
      ...inquiry,
      kind: 'chat',
      senderRole: 'customer',
      messageBody: 'Hi',
    });
    await main.enqueue(manager, inquiry);
    expect(query).toHaveBeenCalledTimes(18);
    const first = query.mock.calls.slice(0, 6);
    const repeats = query.mock.calls.slice(12, 18);
    expect(new Set(first.map((call) => call[1][0])).size).toBe(6);
    expect(repeats.map((call) => call[1][0])).toEqual(first.map((call) => call[1][0]));
    expect(first[0][1][0]).toContain('mocmaria.zalo.outbox.');
    expect(first[1][1][0]).toContain('mocmaria.zalo.linh-dan.outbox.');
    expect(first[2][1][0]).toContain('mocmaria.zalo.hoan.outbox.');
    for (let index = 0; index < STAFF_ZALO_BOTS.length; index++) {
      const call = first[index + 3];
      expect(call[1][0]).toContain(staffOutboxPrefix(STAFF_ZALO_BOTS[index]));
      expect(call[0]).toContain('ON CONFLICT(key) DO NOTHING');
      const payload = JSON.parse(call[1][1]) as { text: string; recipient: string };
      expect(payload.text).not.toContain('0912345678');
      expect(payload.text).not.toContain('mai@example.com');
      expect(payload.text).toContain('0987654321');
    }
    expect(JSON.parse(first[0][1][1]) as { text: string }).toMatchObject({
      text: expect.stringContaining('0912345678') as string,
    });
  });

  it('does not enqueue for a staff bot without a token or approved chat IDs', async () => {
    const values = new Map([
      ['NODE_ENV', 'test'],
      ['ZALO_TUNG_BOT_TOKEN', 'test-token'],
    ]);
    const { staff, manager, query } = setup(values);
    await staff.enqueue(manager, 'booking-123', 'Private details withheld');
    expect(query).not.toHaveBeenCalled();
  });

  it('sends an isolated outbox to its configured recipient only', async () => {
    const values = new Map([
      ['NODE_ENV', 'test'],
      ['ZALO_TUNG_BOT_TOKEN', 'fake-test-token'],
      ['ZALO_TUNG_CHAT_IDS', 'tung-1'],
    ]);
    const { staff, query } = setup(values);
    const send = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    } as Response);
    query
      .mockResolvedValueOnce([
        {
          key: staffOutboxPrefix(STAFF_ZALO_BOTS[1]) + 'key',
          value: {
            recipient: 'tung-1',
            text: 'Private details withheld',
            status: 'pending',
            attempts: 0,
          },
        },
      ])
      .mockResolvedValue([]);
    try {
      await staff.drain();
      expect(send).toHaveBeenCalledTimes(1);
      const init = send.mock.calls[0][1];
      if (!init) throw new Error('Expected Zalo POST request options');
      expect(JSON.parse(init.body as string)).toEqual({
        chat_id: 'tung-1',
        text: 'Private details withheld',
      });
      expect(query.mock.calls[0][1][0]).toContain(staffOutboxPrefix(STAFF_ZALO_BOTS[1]));
    } finally {
      send.mockRestore();
    }
  });
});
