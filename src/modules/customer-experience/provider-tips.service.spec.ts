import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import type { ProviderDisplayService } from '../provider-display/provider-display.service';
import { CreateTipIntentDto, UpdateTipSettingsDto } from './provider-tips.dto';
import { ProviderTipsService } from './provider-tips.service';

describe('Mộc Maria voluntary KTV tips', () => {
  const providerId = '22222222-2222-4222-8222-222222222222';
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const otherId = '33333333-3333-4333-8333-333333333333';
  const clientRequestId = '44444444-4444-4444-8444-444444444444';
  const actor = (id: string, roles: string[]): AuthUserContext =>
    ({ id, roles }) as AuthUserContext;
  const query = jest.fn();
  const save = jest.fn();
  const transaction = jest.fn();
  const display = { publicDisplay: jest.fn() };
  const manager = { query, save };
  const db = { query, manager, transaction };
  const service = new ProviderTipsService(
    db as unknown as DataSource,
    display as unknown as ProviderDisplayService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    display.publicDisplay.mockResolvedValue({ rows: [{ providerId, visible: true }] });
    query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('FROM provider_applications') ? [{ userId: ownerId }] : []),
    );
    save.mockResolvedValue(undefined);
    transaction.mockImplementation((fn: (m: unknown) => unknown) => Promise.resolve(fn(manager)));
  });

  const settings = {
    expectedVersion: 0,
    bankName: 'Vietcombank',
    bankAccount: '1234567890',
    accountHolder: 'NGUYEN HOAN',
    qrUrl: '',
  };

  it('shows an empty, stable config before bank details are set', async () => {
    await expect(service.publicSettings(providerId)).resolves.toEqual({
      version: 0,
      bankName: '',
      bankAccount: '',
      accountHolder: '',
      qrUrl: null,
      updatedAt: null,
    });
  });

  it('hides bank data if the provider is not publicly visible', async () => {
    display.publicDisplay.mockResolvedValue({ rows: [{ providerId, visible: false }] });
    await expect(service.publicSettings(providerId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('restricts bank editing to owner KTV or SUPER_ADMIN', async () => {
    await expect(
      service.editorSettings(actor(otherId, ['THERAPIST']), providerId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.editorSettings(actor(otherId, ['ADMIN']), providerId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.editorSettings(actor(ownerId, ['THERAPIST']), providerId),
    ).resolves.toHaveProperty('version', 0);
    await expect(
      service.editorSettings(actor(otherId, ['SUPER_ADMIN']), providerId),
    ).resolves.toHaveProperty('version', 0);
  });

  it('rejects incorrect account numbers and incomplete bank details', async () => {
    await expect(
      service.saveSettings(actor(ownerId, ['THERAPIST']), providerId, {
        ...settings,
        bankAccount: 'ABC123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.saveSettings(actor(ownerId, ['THERAPIST']), providerId, {
        ...settings,
        bankName: '',
      }),
    ).rejects.toThrow('ngân hàng');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('accepts a new bank configuration and audit record without claiming payments', async () => {
    const result = await service.saveSettings(
      actor(otherId, ['SUPER_ADMIN']),
      providerId,
      settings,
    );
    expect(result).toMatchObject({ version: 1, bankAccount: settings.bankAccount });
    expect(
      query.mock.calls.some(([sql]) => (sql as string).includes('INSERT INTO app_metadata')),
    ).toBe(true);
    expect(save).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        event: 'provider.tip.settings.updated',
        targetUserId: ownerId,
      }),
    );
  });

  it('blocks stale updates before overwriting the current QR/account', async () => {
    query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('FROM provider_applications')
          ? [{ userId: ownerId }]
          : sql.includes('SELECT value FROM app_metadata')
            ? [{ value: { version: 3 } }]
            : [],
      ),
    );
    await expect(
      service.saveSettings(actor(ownerId, ['THERAPIST']), providerId, settings),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not create a tip record when KTV has no QR or account', async () => {
    await expect(
      service.createIntent(providerId, {
        amountVnd: 50_000,
        clientRequestId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      query.mock.calls.some(([sql]) => (sql as string).includes('INSERT INTO app_metadata')),
    ).toBe(false);
  });

  it('records an anonymous intent, not verified revenue', async () => {
    query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('SELECT value FROM app_metadata')
          ? [{ value: { bankAccount: '1234567890', qrUrl: null } }]
          : sql.includes('INSERT INTO app_metadata')
            ? [{ key: 'success' }]
            : [],
      ),
    );
    const result = await service.createIntent(providerId, {
      amountVnd: 100_000,
      clientRequestId,
    });
    expect(result).toMatchObject({ id: clientRequestId, status: 'INTENT', amountVnd: 100_000 });
    expect(result.token).toMatch(/^[a-f0-9-]{36}$/);
    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    const inserted = calls.find(([sql]) => sql.includes('INSERT INTO app_metadata'));
    const payload = JSON.parse(String(inserted?.[1]?.[1])) as Record<string, unknown>;
    expect(payload).toMatchObject({ status: 'INTENT', keepsakePath: null, providerId });
    expect(JSON.stringify(payload)).not.toContain(result.token);
  });

  it('validates custom amount at both DTO and service levels', async () => {
    const dto = plainToInstance(CreateTipIntentDto, { amountVnd: 0, clientRequestId });
    expect(await validate(dto)).not.toHaveLength(0);
    const malformed = plainToInstance(UpdateTipSettingsDto, { ...settings, bankName: 42 });
    expect(await validate(malformed)).not.toHaveLength(0);
    query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('SELECT value FROM app_metadata')
          ? [{ value: { bankAccount: '123', qrUrl: null } }]
          : [],
      ),
    );
    await expect(
      service.createIntent(providerId, {
        amountVnd: 10_000_001,
        clientRequestId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires voluntary, explicit proof consent', async () => {
    await expect(
      service.uploadKeepsake(providerId, clientRequestId, clientRequestId, undefined, undefined),
    ).rejects.toThrow('đồng ý');
  });

  it('stores receipt screenshots as encrypted, authenticated ciphertext', () => {
    const previous = process.env['TIP_KEEPSAKE_SECRET'];
    process.env['TIP_KEEPSAKE_SECRET'] =
      'test-secret-for-dedicated-private-tip-keepsake-encryption-12345';
    try {
      const crypt = service as unknown as {
        encryptKeepsake: (input: Buffer) => Buffer;
        decryptKeepsake: (input: Buffer) => Buffer;
      };
      const plain = Buffer.from('a private transfer receipt that must not appear in CDN');
      const encrypted = crypt.encryptKeepsake(plain);
      expect(encrypted.includes(plain)).toBe(false);
      expect(crypt.decryptKeepsake(encrypted)).toEqual(plain);
      const tampered = Buffer.from(encrypted);
      tampered[tampered.length - 1] ^= 1;
      expect(() => crypt.decryptKeepsake(tampered)).toThrow();
    } finally {
      if (previous === undefined) delete process.env['TIP_KEEPSAKE_SECRET'];
      else process.env['TIP_KEEPSAKE_SECRET'] = previous;
    }
  });
});
