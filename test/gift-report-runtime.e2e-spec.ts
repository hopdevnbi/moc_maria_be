import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildDatabaseOptionsFromEnv } from '../src/database/database-options';
import type { AuthUserContext } from '../src/modules/identity/identity.types';
import { GiftEventsService } from '../src/modules/gift-events/gift-events.service';
import { GiftReportService } from '../src/modules/gift-events/gift-report.service';
import { GiftOperationsService } from '../src/modules/gift-events/gift-operations.service';
import { requireIsolatedDatabase } from './isolated-database';

describe('Gift reporting SQL in disposable PostgreSQL', () => {
  let db: DataSource, report: GiftReportService, operations: GiftOperationsService;
  let actor: AuthUserContext, populated: string, empty: string;
  const previousFlag = process.env['GIFT_EVENTS_ENABLED'];
  const range = { from: '2026-10-15T16:00:00Z', to: '2026-10-16T18:00:00Z' };

  beforeAll(async () => {
    requireIsolatedDatabase();
    process.env['GIFT_EVENTS_ENABLED'] = 'true';
    db = new DataSource(buildDatabaseOptionsFromEnv(process.env));
    await db.initialize();
    const [user] = await db.query<Array<{ id: string }>>(
      "INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,'isolated-no-login') RETURNING id",
      [randomUUID() + '@mocmaria.test', 'Isolated report QA'],
    );
    actor = {
      id: user.id,
      email: null,
      phone: null,
      displayName: 'Isolated report QA',
      isActive: true,
      mustChangePassword: false,
      sessionId: randomUUID(),
      roles: ['SUPER_ADMIN'],
      permissions: ['admin.portal'],
    };
    const events = new GiftEventsService(db);
    report = new GiftReportService(db, events);
    operations = new GiftOperationsService(db, events);
    async function campaign(reserved: number): Promise<string> {
      const code = randomUUID();
      const [row] = await db.query<Array<{ id: string }>>(
        `INSERT INTO gift_event_campaigns(code,slug,title,created_by,budget_cap_vnd,budget_reserved_vnd)
         VALUES($1,$1,$2,$3,100000,$4) RETURNING id`,
        [code, 'Isolated report campaign', user.id, reserved],
      );
      return row.id;
    }
    empty = await campaign(0);
    populated = await campaign(100000);
    const [prize] = await db.query<Array<{ id: string }>>(
      `INSERT INTO gift_event_prizes(event_id,name,kind,weight,stock_total,stock_issued,liability_vnd,created_by)
       VALUES($1,'Isolated voucher','VOUCHER_FIXED',1,10,2,50000,$2) RETURNING id`,
      [populated, user.id],
    );
    for (const issuedAt of ['2026-10-15T16:30:00Z', '2026-10-15T17:30:00Z']) {
      const [customer] = await db.query<Array<{ id: string }>>(
        "INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,'isolated-no-login') RETURNING id",
        [randomUUID() + '@mocmaria.test', 'Isolated report customer'],
      );
      const [entry] = await db.query<Array<{ id: string }>>(
        `INSERT INTO gift_event_entries(event_id,customer_user_id,idempotency_key,request_fingerprint,selected_box,accepted_terms_version)
         VALUES($1,$2,$3,$4,1,1) RETURNING id`,
        [populated, customer.id, randomUUID(), 'a'.repeat(64)],
      );
      await db.query(
        `INSERT INTO gift_event_rewards(entry_id,event_id,prize_id,customer_user_id,reward_snapshot,issued_at,expires_at)
         VALUES($1,$2,$3,$4,'{"liabilityVnd":50000}'::jsonb,$5::timestamptz,$5::timestamptz+interval '30 days')`,
        [entry.id, populated, prize.id, customer.id, issuedAt],
      );
    }
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (previousFlag === undefined) delete process.env['GIFT_EVENTS_ENABLED'];
    else process.env['GIFT_EVENTS_ENABLED'] = previousFlag;
  });

  it('reconciles an empty campaign without a SQL parse error', async () => {
    const data = await report.report(actor, empty);
    expect(data).toMatchObject({ issued: 0, reconciled: true, daily: [] });
  });

  it('reconciles issued vouchers and groups at Vietnam midnight', async () => {
    const data = await report.report(actor, populated);
    expect(data).toMatchObject({ issued: 2, reconciled: true, liabilityIssuedVnd: 100000 });
    expect(data.daily).toEqual([
      { day: '2026-10-15', issued: 1 },
      { day: '2026-10-16', issued: 1 },
    ]);
  });

  it('returns an empty operations range without a SQL parse error', async () => {
    const data = await operations.report(actor, { ...range, eventId: empty });
    expect(data.daily).toEqual([]);
    expect(data.events).toEqual([expect.objectContaining({ eventId: empty, issued: 0 })]);
  });

  it('filters operations by campaign and date while retaining Vietnam day keys', async () => {
    const data = await operations.report(actor, { ...range, eventId: populated });
    expect(data.events).toEqual([expect.objectContaining({ eventId: populated, issued: 2 })]);
    expect(data.daily).toEqual([
      { day: '2026-10-15', issued: 1, redeemed: 0 },
      { day: '2026-10-16', issued: 1, redeemed: 0 },
    ]);
    const filtered = await operations.report(actor, {
      ...range,
      eventId: populated,
      from: '2026-10-15T17:00:00Z',
    });
    expect(filtered.daily).toEqual([{ day: '2026-10-16', issued: 1, redeemed: 0 }]);
  });

  it('aggregates all campaigns when no event filter is supplied', async () => {
    const data = await operations.report(actor, range);
    expect(data.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: empty, issued: 0 }),
        expect.objectContaining({ eventId: populated, issued: 2 }),
      ]),
    );
    expect(data.daily).toEqual([
      { day: '2026-10-15', issued: 1, redeemed: 0 },
      { day: '2026-10-16', issued: 1, redeemed: 0 },
    ]);
  });
});
