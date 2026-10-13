import { ForbiddenException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AuthUserContext } from '../identity/identity.types';
import { AdminAppointmentInquiriesService } from './admin-appointment-inquiries.service';

describe('AdminAppointmentInquiriesService', () => {
  it('denies access before reading private records', async () => {
    const query = jest.fn();
    const service = new AdminAppointmentInquiriesService({ query } as unknown as DataSource);
    const customer = { roles: ['CUSTOMER'], permissions: ['customer.portal'] } as AuthUserContext;
    await expect(service.list(customer, { page: 1, limit: 20 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(query).not.toHaveBeenCalled();
  });
});
