import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { alertText, ZaloAlertsService, type ZaloAlert } from './zalo-alerts.service';
import { STAFF_ZALO_BOTS, staffOutboxPrefix, ZaloKtvBotsService } from './zalo-ktv-bots.service';
import { ZaloHoanAlertsService } from './zalo-hoan-alerts.service';
import { ZaloLinhDanAlertsService } from './zalo-linh-dan-alerts.service';
import { privateZaloText } from './zalo-message-privacy';

const manh = '44174274-e46e-418d-a08b-e26ceede49b7';
const nguyet = '1ddd7a59-3150-4ced-aa5b-052a51f367f9';
const thanhThanh = '4d0f6e3e-fd0e-4c84-841c-1be521de1086';
const tung = 'd9c0c4b2-35d3-4672-9f5b-8b084ecb3341';
const eventId = 'ab'.repeat(32);
const inquiry: ZaloAlert = {
  kind: 'inquiry',
  eventId,
  providerId: manh,
  customerName: 'Khách 0912345678 mai@example.com',
  customerPhone: '0912345678',
  customerEmail: 'mai@example.com',
  providerName: 'Bác sĩ Tiến Mạnh',
  serviceName: 'Massage body',
};
const variables = new Map([
  ['NODE_ENV', 'test'],
  ['ZALO_BOT_TOKEN', 'main-test'],
  ['ZALO_ADMIN_CHAT_IDS', 'admin-1'],
  ['ZALO_LINH_DAN_BOT_TOKEN', 'dan-test'],
  ['ZALO_LINH_DAN_CHAT_IDS', 'dan-1'],
  ['ZALO_HOAN_BOT_TOKEN', 'hoan-test'],
  ['ZALO_HOAN_CHAT_IDS', 'hoan-1'],
  ['ZALO_TIEN_MANH_BOT_TOKEN', 'manh-test'],
  ['ZALO_TIEN_MANH_CHAT_IDS', 'manh-1,manh-1,bad/id'],
  ['ZALO_TIEN_MANH_PROVIDER_ID', manh],
  ['ZALO_NGUYET_BOT_TOKEN', 'nguyet-test'],
  ['ZALO_NGUYET_CHAT_IDS', 'nguyet-1'],
  ['ZALO_NGUYET_PROVIDER_ID', nguyet],
  ['ZALO_THANH_THANH_BOT_TOKEN', 'thanh-thanh-test'],
  ['ZALO_THANH_THANH_CHAT_IDS', 'thanh-thanh-1'],
  ['ZALO_THANH_THANH_PROVIDER_ID', thanhThanh],
  ['ZALO_TUNG_BOT_TOKEN', 'tung-test'],
  ['ZALO_TUNG_CHAT_IDS', 'tung-1'],
  ['ZALO_TUNG_PROVIDER_ID', tung],
]);
function setup(values = variables): {
  staff: ZaloKtvBotsService;
  main: ZaloAlertsService;
  manager: EntityManager;
  query: jest.Mock<Promise<unknown[]>, [string, unknown[]]>;
} {
  const config = { get: (key: string): string | undefined => values.get(key) } as ConfigService;
  const query = jest.fn<Promise<unknown[]>, [string, unknown[]]>().mockResolvedValue([]);
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
  return { staff, main, manager: { query } as unknown as EntityManager, query };
}
describe('KTV-specific Zalo routing with unchanged admin fanout', () => {
  it.each([
    [manh, 'tien-manh', 'manh-1'],
    [nguyet, 'nguyet', 'nguyet-1'],
    [thanhThanh, 'thanh-thanh', 'thanh-thanh-1'],
    [tung, 'tung', 'tung-1'],
  ])(
    'sends %s booking only to its own KTV plus all three admin channels',
    async (providerId, slug, recipient) => {
      const { main, manager, query } = setup();
      await main.enqueue(manager, { ...inquiry, providerId });
      expect(query).toHaveBeenCalledTimes(4);
      const keys = query.mock.calls.map(([, params]) => params[0]);
      expect(keys.every((key) => (key as string).length <= 100)).toBe(true);
      expect(keys.slice(0, 3)).toEqual([
        expect.stringContaining('mocmaria.zalo.outbox.'),
        expect.stringContaining('mocmaria.zalo.linh-dan.outbox.'),
        expect.stringContaining('mocmaria.zalo.hoan.outbox.'),
      ]);
      expect(keys[3]).toEqual(expect.stringContaining(`mocmaria.zalo.staff.${slug}.outbox.`));
      const payload = JSON.parse(query.mock.calls[3][1][1] as string) as {
        recipient: string;
        providerId: string;
        text: string;
      };
      expect(payload).toMatchObject({ recipient, providerId });
      expect(payload.text).toContain('/tin-nhan?inquiry=' + eventId);
      for (const [, params] of query.mock.calls) {
        const text = (JSON.parse(params[1] as string) as { text: string }).text;
        expect(text).not.toContain('0912345678');
        expect(text).not.toContain('mai@example.com');
      }
    },
  );
  it.each([manh, nguyet, thanhThanh, tung])(
    'routes inbound customer chat to only provider %s with deterministic deduplication',
    async (providerId) => {
      const { main, manager, query } = setup();
      const threadId = 'c03e834b-7a53-4f6f-b893-87fd04039bd5';
      const event: ZaloAlert = {
        ...inquiry,
        providerId,
        kind: 'chat',
        senderRole: 'customer',
        threadId,
        messageBody: 'Gọi +84 912 345 678, mai@example.com',
      };
      await main.enqueue(manager, event);
      await main.enqueue(manager, event);
      expect(query).toHaveBeenCalledTimes(8);
      expect(query.mock.calls[3][1][0]).toBe(query.mock.calls[7][1][0]);
      const text = (JSON.parse(query.mock.calls[3][1][1] as string) as { text: string }).text;
      expect(text).toContain('/tin-nhan?thread=' + threadId);
      expect(text).not.toContain('+84 912 345 678');
      expect(text).not.toContain('mai@example.com');
    },
  );
  it('never creates a Thanh Thanh outbox for another KTV or an outgoing KTV reply', async () => {
    const { staff, manager, query } = setup();
    for (const providerId of [manh, nguyet, tung, 'unknown-provider']) {
      await staff.enqueue(manager, eventId, 'Own booking', 'inquiry', providerId);
      await staff.enqueue(manager, eventId, 'Customer message', 'chat', providerId, 'customer');
    }
    await staff.enqueue(manager, eventId, 'KTV reply', 'chat', thanhThanh, 'provider');
    expect(
      query.mock.calls.every(([, params]) => !(params[0] as string).includes('.thanh-thanh.')),
    ).toBe(true);
  });
  it('never delivers other KTV events, self replies or unbound Tung configuration to the Tung bot', async () => {
    const { staff, manager, query } = setup();
    for (const providerId of [manh, nguyet, thanhThanh, undefined]) {
      await staff.enqueue(manager, eventId, 'Booking', 'inquiry', providerId);
      await staff.enqueue(manager, eventId, 'Customer chat', 'chat', providerId, 'customer');
    }
    await staff.enqueue(manager, eventId, 'KTV reply', 'chat', tung, 'provider');
    expect(query.mock.calls.every(([, params]) => !(params[0] as string).includes('.tung.'))).toBe(
      true,
    );
    for (const missing of ['ZALO_TUNG_BOT_TOKEN', 'ZALO_TUNG_PROVIDER_ID', 'ZALO_TUNG_CHAT_IDS']) {
      const values = new Map(variables);
      values.delete(missing);
      const test = setup(values);
      await test.staff.enqueue(test.manager, eventId, 'Booking', 'inquiry', tung);
      expect(test.query).not.toHaveBeenCalled();
    }
  });
  it('keeps outgoing KTV replies and unknown providers on admin channels only', async () => {
    const { main, manager, query } = setup();
    await main.enqueue(manager, { ...inquiry, kind: 'chat', senderRole: 'provider' });
    await main.enqueue(manager, { ...inquiry, providerId: 'other-provider' });
    await main.enqueue(manager, { ...inquiry, providerId: undefined });
    expect(query).toHaveBeenCalledTimes(9);
    expect(query.mock.calls.every(([, p]) => !(p[0] as string).includes('.staff.'))).toBe(true);
  });
  it('fails closed if recipient or provider binding is absent', async () => {
    for (const missing of [
      'ZALO_TIEN_MANH_CHAT_IDS',
      'ZALO_TIEN_MANH_PROVIDER_ID',
      'ZALO_TIEN_MANH_BOT_TOKEN',
    ]) {
      const values = new Map(variables);
      values.delete(missing);
      const t = setup(values);
      await t.staff.enqueue(t.manager, eventId, 'hello', 'inquiry', manh);
      expect(t.query).not.toHaveBeenCalled();
    }
  });
  it('never exposes password protected chat excerpts', () => {
    const text = alertText(
      { ...inquiry, kind: 'chat', messageBody: 'secret@example.com', chatPrivacyProtected: true },
      { audience: 'ktv' },
    );
    expect(text).toContain('Hội thoại được bảo vệ');
    expect(text).not.toContain('secret@example.com');
  });
  it('redacts legacy pending delivery bodies and keeps validated internal UUID links intact', () => {
    const text = privateZaloText(
      'Khách: Mai\nSĐT khách: 0912345678\nEmail: mai@example.com\n  Call +1 (202) 555-0123\nhttps://mocmaria.com/tin-nhan?inquiry=' +
        eventId,
    );
    expect(text).not.toMatch(/0912345678|mai@example.com|202.*555/);
    expect(text).toContain('/tin-nhan?inquiry=' + eventId);
  });
  it('requires scoped owner identity in the leased delivery query and sanitizes before HTTP', async () => {
    const { staff, query } = setup();
    query
      .mockResolvedValueOnce([
        {
          key: staffOutboxPrefix(STAFF_ZALO_BOTS[0]) + 'a',
          value: {
            providerId: manh,
            recipient: 'manh-1',
            text: 'phone 0912345678 mai@example.com',
            attempts: 0,
          },
        },
      ])
      .mockResolvedValue([]);
    const send = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) } as Response);
    try {
      await staff.drain();
      expect(query.mock.calls[0][0]).toContain("value->>'providerId'=$4");
      expect(query.mock.calls[0][1][3]).toBe(manh);
      expect(send).toHaveBeenCalledTimes(1);
      const body = JSON.parse(send.mock.calls[0][1]!.body as string) as {
        chat_id: string;
        text: string;
      };
      expect(body.chat_id).toBe('manh-1');
      expect(body.text).not.toContain('0912345678');
      expect(body.text).not.toContain('mai@example.com');
    } finally {
      send.mockRestore();
    }
  });
});
