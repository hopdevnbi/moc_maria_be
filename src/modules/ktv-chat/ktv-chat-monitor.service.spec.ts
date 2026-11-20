import { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { KtvChatMonitorService } from './ktv-chat-monitor.service';
const admin = {
  id: 'admin',
  isActive: true,
  roles: ['SUPER_ADMIN'],
  permissions: ['admin.portal', 'customers.manage'],
} as AuthUserContext;
describe('Super Admin chat monitor', () => {
  it.each(['ADMIN', 'THERAPIST', 'CUSTOMER', 'RECEPTIONIST'])(
    'denies %s before any database work',
    async (role) => {
      const transaction = jest.fn();
      const service = new KtvChatMonitorService({ transaction } as unknown as DataSource);
      await expect(
        service.list({ ...admin, roles: [role] as AuthUserContext['roles'] }),
      ).rejects.toMatchObject({ status: 403 });
      expect(transaction).not.toHaveBeenCalled();
    },
  );
  it('denies inactive or missing permission', async () => {
    const transaction = jest.fn();
    const service = new KtvChatMonitorService({ transaction } as unknown as DataSource);
    await expect(service.list({ ...admin, isActive: false })).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.list({ ...admin, permissions: [] })).rejects.toMatchObject({
      status: 403,
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
