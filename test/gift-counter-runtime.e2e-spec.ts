import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildDatabaseOptionsFromEnv } from '../src/database/database-options';
import type { AuthUserContext } from '../src/modules/identity/identity.types';
import { GiftEventsService } from '../src/modules/gift-events/gift-events.service';
import { GiftRedeemService } from '../src/modules/gift-events/gift-redeem.service';
import { hashGiftCounterPin } from '../src/modules/gift-events/gift-wallet.service';
import { requireIsolatedDatabase } from './isolated-database';

describe('Optional voucher reference in isolated PostgreSQL', () => {
  let db: DataSource, service: GiftRedeemService, actor: AuthUserContext;
  let branchId: string, serviceId: string, variantId: string, eventId: string, prizeId: string;
  let pinSequence = 100000;
  const previousFlag = process.env['GIFT_EVENTS_ENABLED'];
  const previousPinSecret = process.env['GIFT_COUNTER_PIN_SECRET'];
  beforeAll(async () => {
    requireIsolatedDatabase();
    process.env['GIFT_EVENTS_ENABLED'] = 'true';
    process.env['GIFT_COUNTER_PIN_SECRET'] = randomBytes(40).toString('base64url');
    db = new DataSource(buildDatabaseOptionsFromEnv(process.env));
    await db.initialize();
    const [user] = await db.query<Array<{ id: string }>>(
      "INSERT INTO users(email,display_name,password_hash) VALUES($1,'Isolated counter staff','no-login') RETURNING id",
      [randomUUID() + '@mocmaria.test'],
    );
    actor = {
      id: user.id,
      email: null,
      phone: null,
      displayName: 'Isolated counter staff',
      isActive: true,
      mustChangePassword: false,
      sessionId: randomUUID(),
      roles: ['SUPER_ADMIN'],
      permissions: ['admin.portal'],
    };
    const [branch] = await db.query<Array<{ id: string }>>(
      "INSERT INTO branches(name,code,address) VALUES('Isolated branch',$1,'Isolated address') RETURNING id",
      [randomUUID()],
    );
    branchId = branch.id;
    const [category] = await db.query<Array<{ id: string }>>(
      "INSERT INTO service_categories(name,slug,is_published) VALUES('Isolated care',$1,true) RETURNING id",
      [randomUUID()],
    );
    const [item] = await db.query<Array<{ id: string }>>(
      "INSERT INTO services(category_id,name,slug,is_published) VALUES($1,'Isolated service',$2,true) RETURNING id",
      [category.id, randomUUID()],
    );
    serviceId = item.id;
    const [variant] = await db.query<Array<{ id: string }>>(
      "INSERT INTO service_variants(service_id,name,duration_minutes,price_vnd) VALUES($1,'60 minutes',60,249000) RETURNING id",
      [serviceId],
    );
    variantId = variant.id;
    await db.query(
      'INSERT INTO branch_services(branch_id,service_id,price_override_vnd) VALUES($1,$2,299000)',
      [branchId, serviceId],
    );
    const [event] = await db.query<Array<{ id: string }>>(
      "INSERT INTO gift_event_campaigns(code,slug,title,created_by,budget_cap_vnd) VALUES($1,$1,'Isolated campaign',$2,10000000) RETURNING id",
      [randomUUID(), actor.id],
    );
    eventId = event.id;
    const [prize] = await db.query<Array<{ id: string }>>(
      "INSERT INTO gift_event_prizes(event_id,name,kind,weight,stock_total,liability_vnd,created_by) VALUES($1,'Isolated voucher','VOUCHER_PERCENT',1,100,150000,$2) RETURNING id",
      [eventId, actor.id],
    );
    prizeId = prize.id;
    service = new GiftRedeemService(db, new GiftEventsService(db));
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (previousFlag === undefined) delete process.env['GIFT_EVENTS_ENABLED'];
    else process.env['GIFT_EVENTS_ENABLED'] = previousFlag;
    if (previousPinSecret === undefined) delete process.env['GIFT_COUNTER_PIN_SECRET'];
    else process.env['GIFT_COUNTER_PIN_SECRET'] = previousPinSecret;
  });
  async function credential(
    mode: 'CODE' | 'QR',
    expired = false,
  ): Promise<{ id: string; value: string }> {
    const [customer] = await db.query<Array<{ id: string }>>(
      "INSERT INTO users(email,display_name,password_hash) VALUES($1,'Isolated customer','no-login') RETURNING id",
      [randomUUID() + '@mocmaria.test'],
    );
    const [entry] = await db.query<Array<{ id: string }>>(
      'INSERT INTO gift_event_entries(event_id,customer_user_id,idempotency_key,request_fingerprint,selected_box,accepted_terms_version) VALUES($1,$2,$3,$4,1,1) RETURNING id',
      [eventId, customer.id, randomUUID(), 'a'.repeat(64)],
    );
    const snapshot = {
      kind: 'VOUCHER_PERCENT',
      name: 'Isolated voucher',
      allowedBranchIds: [branchId],
      config: {
        percent: 20,
        minSpendVnd: 0,
        maxDiscountVnd: 150000,
        allowedServiceIds: [serviceId],
      },
    };
    const [reward] = await db.query<Array<{ id: string }>>(
      "INSERT INTO gift_event_rewards(entry_id,event_id,prize_id,customer_user_id,reward_snapshot,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,now()+interval '7 days') RETURNING id",
      [entry.id, eventId, prizeId, customer.id, JSON.stringify(snapshot)],
    );
    const value = mode === 'CODE' ? String(++pinSequence) : randomBytes(32).toString('base64url');
    const table = mode === 'CODE' ? 'gift_event_counter_pins' : 'gift_event_qr_tokens';
    const column = mode === 'CODE' ? 'pin_hash' : 'token_hash';
    const hash =
      mode === 'CODE'
        ? hashGiftCounterPin(value)
        : createHash('sha256').update(value).digest('hex');
    await db.query(`INSERT INTO ${table}(reward_id,${column},expires_at) VALUES($1,$2,$3)`, [
      reward.id,
      hash,
      new Date(Date.now() + (expired ? -60000 : 240000)),
    ]);
    return { id: reward.id, value };
  }
  const items = (): Array<{ variantId: string; quantity: number }> => [{ variantId, quantity: 1 }];
  async function history(id: string): Promise<Record<string, unknown>> {
    const [row] = await db.query<Array<{ metadata: Record<string, unknown> }>>(
      "SELECT metadata FROM gift_event_redemption_history WHERE reward_id=$1 AND action='REDEEM'",
      [id],
    );
    return row.metadata;
  }
  it.each(['CODE', 'QR'] as const)(
    'prices and redeems by %s without any invoice reference',
    async (mode) => {
      const c = await credential(mode);
      const common = { branchId, items: items() };
      const quote =
        mode === 'CODE'
          ? await service.quoteCode(actor, { ...common, code: c.value })
          : await service.quoteQr(actor, { ...common, token: c.value });
      expect(quote).toMatchObject({ subtotalVnd: 299000, discountVnd: 59800, payableVnd: 239200 });
      const request = { ...common, idempotencyKey: randomUUID() };
      const result =
        mode === 'CODE'
          ? await service.redeemCode(actor, { ...request, code: c.value })
          : await service.redeem(actor, { ...request, token: c.value });
      expect(result.status).toBe('REDEEMED');
      expect(await history(c.id)).toMatchObject({
        discountVnd: 59800,
        payableVnd: 239200,
        items: items(),
        verifiedOnline: true,
      });
      expect(await history(c.id)).not.toHaveProperty('saleReference');
    },
  );
  it('allows multiple redemptions with blank references without a unique-index collision', async () => {
    for (const saleReference of ['', '   ']) {
      const c = await credential('CODE');
      await service.redeemCode(actor, {
        code: c.value,
        branchId,
        idempotencyKey: randomUUID(),
        items: items(),
        saleReference,
      });
      expect(await history(c.id)).not.toHaveProperty('saleReference');
    }
  });
  it('retains an optional human-readable reference and prevents reuse when supplied', async () => {
    const first = await credential('CODE');
    const saleReference = 'Ca chiều / ' + randomUUID();
    await service.redeemCode(actor, {
      code: first.value,
      branchId,
      idempotencyKey: randomUUID(),
      items: items(),
      saleReference: '  ' + saleReference + '  ',
    });
    expect(await history(first.id)).toHaveProperty('saleReference', saleReference);
    const second = await credential('CODE');
    await expect(
      service.redeemCode(actor, {
        code: second.value,
        branchId,
        idempotencyKey: randomUUID(),
        items: items(),
        saleReference,
      }),
    ).rejects.toThrow();
    const [reward] = await db.query<Array<{ status: string }>>(
      'SELECT status FROM gift_event_rewards WHERE id=$1',
      [second.id],
    );
    expect(reward.status).toBe('ISSUED');
  });
  it('still requires actual catalog items for a percent voucher', async () => {
    const c = await credential('CODE');
    await expect(
      service.redeemCode(actor, { code: c.value, branchId, idempotencyKey: randomUUID() }),
    ).rejects.toThrow('VOUCHER_ITEMS_REQUIRED');
  });
  it('still rejects expired credentials for both pricing and redemption', async () => {
    const c = await credential('CODE', true);
    await expect(
      service.quoteCode(actor, { code: c.value, branchId, items: items() }),
    ).rejects.toThrow('QR_EXPIRED');
    await expect(
      service.redeemCode(actor, {
        code: c.value,
        branchId,
        items: items(),
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow('QR_EXPIRED');
  });
  it('keeps redemption idempotent and blocks a second claim', async () => {
    const c = await credential('QR');
    const request = { token: c.value, branchId, items: items(), idempotencyKey: randomUUID() };
    await service.redeem(actor, request);
    expect((await service.redeem(actor, request)).alreadyProcessed).toBe(true);
    await expect(
      service.redeem(actor, { ...request, idempotencyKey: randomUUID() }),
    ).rejects.toThrow('ALREADY_REDEEMED');
  });
});
