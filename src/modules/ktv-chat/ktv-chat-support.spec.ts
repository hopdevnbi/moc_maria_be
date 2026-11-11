import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import type { KtvChatService } from './ktv-chat.service';
import { KtvInquiryChatService } from './ktv-inquiry-chat.service';

it('rejects malformed support locators and non-super-admin entry before database access', async () => {
  const transaction = jest.fn();
  const service = new KtvInquiryChatService(
    { transaction } as unknown as DataSource,
    {} as KtvChatService,
  );
  const actor = {
    id: 'admin',
    roles: ['SUPER_ADMIN'],
    permissions: ['admin.portal', 'customers.manage'],
    isActive: true,
  } as AuthUserContext;
  for (const locator of [
    '-'.repeat(36),
    'a'.repeat(36),
    '11111111-1111-4111-1111-111111111111',
    'not-a-thread',
  ])
    await expect(service.support(actor, locator, 'thread')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  await expect(service.support(actor, 'not-an-inquiry', 'inquiry')).rejects.toBeInstanceOf(
    NotFoundException,
  );
  for (const roles of [['ADMIN'], ['THERAPIST'], ['CUSTOMER']] as AuthUserContext['roles'][])
    await expect(
      service.support({ ...actor, roles }, 'ab'.repeat(32), 'inquiry'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  await expect(
    service.support({ ...actor, isActive: false }, 'ab'.repeat(32), 'inquiry'),
  ).rejects.toBeInstanceOf(ForbiddenException);
  expect(transaction).not.toHaveBeenCalled();
});
