import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { ProvidersService } from '../providers/providers.service';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvChatService } from './ktv-chat.service';

const providerId = '00000000-0000-4000-8000-000000000001';
const customerId = '00000000-0000-4000-8000-000000000002';
const ktvId = '00000000-0000-4000-8000-000000000003';
const threadId = '00000000-0000-4000-8000-000000000004';

function actor(permissions: string[] = ['customer.portal']): AuthUserContext {
  return {
    id: customerId,
    email: 'example@invalid.test',
    phone: null,
    displayName: 'Khách hàng',
    isActive: true,
    mustChangePassword: false,
    sessionId: '00000000-0000-4000-8000-000000000005',
    roles: ['CUSTOMER'],
    permissions,
  };
}

describe('KTV chat access and message rules', () => {
  const query = jest.fn();
  const managerQuery = jest.fn();
  const publicProvider = jest.fn();
  const transaction = jest.fn(
    async (callback: (manager: { query: typeof managerQuery }) => Promise<unknown>) =>
      callback({ query: managerQuery }),
  );
  const service = new KtvChatService(
    { query, transaction } as unknown as DataSource,
    { publicProvider } as unknown as ProvidersService,
  );

  beforeEach(() => {
    query.mockReset();
    managerQuery.mockReset();
    publicProvider.mockReset();
    transaction.mockClear();
  });

  it('does not allow a non-customer to open a chat', async () => {
    await expect(service.open(actor(['staff.portal']), providerId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(publicProvider).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses to open chat with unapproved or ineligible KTV', async () => {
    publicProvider.mockRejectedValueOnce(new NotFoundException('Not found'));
    await expect(service.open(actor(), providerId)).rejects.toBeInstanceOf(NotFoundException);
    expect(query).not.toHaveBeenCalled();
  });

  it('opens or reuses a thread for a verified KTV', async () => {
    publicProvider.mockResolvedValueOnce({ id: providerId });
    query.mockResolvedValueOnce([{ user_id: ktvId }]).mockResolvedValueOnce([
      {
        id: threadId,
        customer_user_id: customerId,
        provider_user_id: ktvId,
        provider_application_id: providerId,
      },
    ]);
    const thread = await service.open(actor(), providerId);
    expect(thread.id).toBe(threadId);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not disclose messages to someone outside the thread', async () => {
    query.mockResolvedValueOnce([]);
    await expect(service.messages(actor(), threadId)).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects whitespace-only messages before a database operation', async () => {
    await expect(service.send(actor(), threadId, '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects sends once sender has reached per-minute rate limit', async () => {
    query
      .mockResolvedValueOnce([
        {
          id: threadId,
          provider_application_id: providerId,
          customer_user_id: customerId,
          provider_user_id: ktvId,
        },
      ])
      .mockResolvedValueOnce([{ user_id: ktvId }]);
    publicProvider.mockResolvedValueOnce({ id: providerId });
    managerQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 15 }]);
    await expect(service.send(actor(), threadId, 'Xin chào')).rejects.toMatchObject({
      status: 429,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(managerQuery).toHaveBeenCalledTimes(2);
  });
});
