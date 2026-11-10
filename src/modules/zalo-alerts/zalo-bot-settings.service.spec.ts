import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { ZaloAlertsService } from './zalo-alerts.service';
import { ZaloHoanAlertsService } from './zalo-hoan-alerts.service';
import { ZaloKtvBotsService } from './zalo-ktv-bots.service';
import { ZaloBotSettingsService, type ZaloBotSwitches } from './zalo-bot-settings.service';

describe('Zalo bot management switches', () => {
  const values: Record<string, string> = {
    ZALO_BOT_TOKEN: 'private-primary-token',
    ZALO_ADMIN_CHAT_IDS: 'recipient-alpha-123456,recipient-beta-654321',
    ZALO_WEBHOOK_SECRET: 'private-webhook-secret',
    ZALO_HOAN_BOT_TOKEN: 'private-hoan-token',
    ZALO_HOAN_CHAT_IDS: 'recipient-hoan-123456',
    ZALO_TIEN_MANH_BOT_TOKEN: 'private-staff-token',
    ZALO_TIEN_MANH_CHAT_IDS: 'recipient-staff-123456',
    ZALO_TIEN_MANH_PROVIDER_ID: 'provider-1',
  };
  const config = {
    get: (key: string) => values[key],
  } as ConfigService;

  function setup(): {
    service: ZaloBotSettingsService;
    db: DataSource;
    query: jest.Mock;
    saved: Map<string, Partial<ZaloBotSwitches>>;
  } {
    const saved = new Map<string, Partial<ZaloBotSwitches>>();
    const query = jest.fn().mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT value FROM app_metadata WHERE key=$1')) {
        const value = saved.get(String(params?.[0]));
        return Promise.resolve(value ? [{ value }] : []);
      }
      if (sql.includes('INSERT INTO app_metadata(key,value)')) {
        const key = String(params?.[0]);
        const patch = JSON.parse(String(params?.[1])) as Partial<ZaloBotSwitches>;
        saved.set(key, { ...saved.get(key), ...patch });
      }
      return Promise.resolve([]);
    });
    const db = { query } as unknown as DataSource;
    const service = new ZaloBotSettingsService(db, config);
    return { service, db, query, saved };
  }

  it('defaults all seven bots and all features to enabled without stored records', async () => {
    const { service } = setup();
    const { bots } = await service.list();
    expect(bots.map((bot) => bot.id)).toEqual([
      'primary',
      'linh-dan',
      'hoan',
      'tien-manh',
      'tung',
      'nguyet',
      'thanh-thanh',
    ]);
    for (const bot of bots) {
      expect(bot).toMatchObject({
        enabled: true,
        bookingEnabled: true,
        chatEnabled: true,
      });
    }
  });

  it('updates only requested booleans and applies switches per bot and notification type', async () => {
    const { service } = setup();
    await service.update('hoan', { bookingEnabled: false });
    expect(await service.allows('hoan', 'inquiry')).toBe(false);
    expect(await service.allows('hoan', 'chat')).toBe(true);
    expect(await service.allows('primary', 'inquiry')).toBe(true);
    await service.update('hoan', { chatEnabled: false });
    expect(await service.get('hoan')).toEqual({
      enabled: true,
      bookingEnabled: false,
      chatEnabled: false,
    });
    expect(await service.allows('hoan', 'other')).toBe(true);
    await service.update('hoan', { enabled: false });
    expect(await service.allows('hoan', 'other')).toBe(false);
  });

  it('never returns raw recipient identifiers, tokens or secrets in management details', async () => {
    const { service } = setup();
    const detail = await service.detail('primary');
    expect(detail).toMatchObject({
      id: 'primary',
      category: 'admin',
      tokenConfigured: true,
      webhookConfigured: true,
      recipientCount: 2,
    });
    const serialized = JSON.stringify(detail);
    expect(detail.maskedRecipients).toHaveLength(2);
    expect(serialized).not.toContain('recipient-alpha-123456');
    expect(serialized).not.toContain('private-primary-token');
    expect(serialized).not.toContain('private-webhook-secret');
  });

  it('rejects malformed writes, unknown keys and unknown bots before modifying storage', async () => {
    const { service, query } = setup();
    await expect(service.update('primary', { bookingEnabled: 'false' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.update('primary', { token: 'new-token' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.update('primary', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('missing', { enabled: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('blocks enqueue and outbox draining while switches are off', async () => {
    const { db, query } = setup();
    const manager = { query } as unknown as EntityManager;
    const allows = jest.fn().mockResolvedValue(false);
    const disabled = {
      allows,
      get: jest.fn().mockResolvedValue({
        enabled: false,
        bookingEnabled: true,
        chatEnabled: true,
      }),
    } as unknown as ZaloBotSettingsService;
    const main = new ZaloAlertsService(db, config, undefined, undefined, undefined, disabled);
    const hoan = new ZaloHoanAlertsService(db, config, disabled);
    const staff = new ZaloKtvBotsService(db, config, disabled);

    await main.enqueueText(manager, 'digest:abc:1', 'chat digest');
    await hoan.enqueue(manager, 'booking-1', 'booking info', 'inquiry');
    await staff.enqueue(manager, 'message-1', 'chat text', 'chat', 'provider-1', 'customer');
    await main.drain();
    await hoan.drain();
    await staff.drain();
    expect(allows).toHaveBeenCalledWith('primary', 'chat', manager);
    expect(allows).toHaveBeenCalledWith('hoan', 'inquiry', manager);
    expect(allows).toHaveBeenCalledWith('tien-manh', 'chat', manager);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps pre-queued typed booking notifications paused while booking is disabled', async () => {
    const { db, query } = setup();
    const switches = {
      get: jest.fn().mockResolvedValue({
        enabled: true,
        bookingEnabled: false,
        chatEnabled: true,
      }),
    } as unknown as ZaloBotSettingsService;
    const main = new ZaloAlertsService(db, config, undefined, undefined, undefined, switches);
    await main.drain();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("value->>'kind' IS DISTINCT FROM 'inquiry'"),
      expect.arrayContaining([false, true]),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("value->>'kind' IS DISTINCT FROM 'chat'"),
      expect.arrayContaining([false, true]),
    );
  });
});
