import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import type { KtvChatService } from '../ktv-chat/ktv-chat.service';
import type { AuthUserContext } from '../identity/identity.types';
import { AdminIntakeService } from './admin-intake.service';

const admin = {
  id: '11111111-1111-4111-8111-111111111111',
  roles: ['SUPER_ADMIN'],
  permissions: ['customers.manage'],
} as AuthUserContext;

function fixture(configured = false): {
  service: AdminIntakeService;
  calls: Array<{ sql: string; params: unknown[] }>;
  query: jest.Mock;
} {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT id FROM roles')) return Promise.resolve([{ id: 'role-1' }]);
    if (sql.includes('INSERT INTO users')) return Promise.resolve([{ id: 'customer-1' }]);
    return Promise.resolve([]);
  });
  const db = {
    query,
    transaction: (fn: (m: EntityManager) => unknown) => fn({ query } as unknown as EntityManager),
  } as unknown as DataSource;
  const config = {
    get: (name: string) =>
      configured ? (name === 'QUEUE_SERVICE_URL' ? 'https://queue.test' : 'test-key') : undefined,
  } as ConfigService;
  const service = new AdminIntakeService(
    db,
    { directory: jest.fn().mockResolvedValue([]) } as unknown as KtvChatService,
    config,
  );
  return { service, calls, query };
}

describe('Super Admin quick customer onboarding', () => {
  afterEach(() => jest.restoreAllMocks());
  it('rejects anyone without the exact Super Admin role before reading DB', async () => {
    const { service, query } = fixture();
    await expect(
      service.createCustomer(
        { ...admin, roles: ['ADMIN'] },
        {
          displayName: 'Khách được tạo',
          email: 'new@example.com',
          sendEmail: false,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('creates only a CUSTOMER profile and returns a random password once, never persisted in plaintext', async () => {
    const { service, calls } = fixture();
    const value = await service.createCustomer(admin, {
      displayName: 'Khách dùng dịch vụ',
      phone: '0988888777',
      sendEmail: false,
    });
    expect(value).toMatchObject({
      mustChangePassword: true,
      emailStatus: 'NOT_REQUESTED',
      customer: { id: 'customer-1' },
    });
    expect(value.temporaryPassword).toMatch(/^Mm9-/);
    expect(calls.find((x) => x.sql.includes('SELECT id FROM roles'))?.params).toEqual(['CUSTOMER']);
    const insert = calls.find((x) => x.sql.includes('INSERT INTO users'))!;
    expect(insert.params[3]).toEqual(expect.stringContaining('$argon2id$'));
    expect(JSON.stringify(calls)).not.toContain(value.temporaryPassword);
    expect(calls.some((x) => x.sql.includes('INSERT INTO customers('))).toBe(true);
    expect(calls.some((x) => x.sql.includes('ADMIN_CUSTOMER_CREATED'))).toBe(true);
  });

  it('queues a one-time setup link instead of emailing the password', async () => {
    const { service, calls } = fixture(true);
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    const value = await service.createCustomer(admin, {
      displayName: 'Khách mới',
      email: 'new@example.com',
      sendEmail: true,
    });
    expect(value.emailStatus).toBe('QUEUED');
    const params = JSON.stringify(calls);
    expect(params).toContain('INSERT INTO password_reset_tokens');
    const request = fetchMock.mock.calls[0][1]!;
    const job = JSON.parse(typeof request.body === 'string' ? request.body : '{}') as {
      data: { text: string; html: string };
    };
    expect(job.data.text).toContain('dat-lai-mat-khau?token=');
    expect(job.data.html).toContain('charset="UTF-8"');
    expect(JSON.stringify(job)).not.toContain(value.temporaryPassword);
  });
});
