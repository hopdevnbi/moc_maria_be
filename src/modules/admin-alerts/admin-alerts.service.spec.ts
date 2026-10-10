import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { AdminAlertRecipient } from './admin-alert-recipient.entity';
import { AdminAlertsService, type BookingAlert } from './admin-alerts.service';

const event: BookingAlert = {
  appointmentId: '11111111-1111-4111-8111-111111111111',
  customerName: 'Khách kiểm thử',
  customerEmail: 'customer@example.com',
  customerPhone: null,
  providerName: 'KTV Linh Anh',
  serviceName: 'Massage',
  branchName: 'Hà Nội',
  startsAt: '2026-10-12T08:00:00.000Z',
  totalVnd: '350000',
  notes: null,
};

describe('Mộc Maria booking admin notifications', () => {
  const recipients = {
    find: jest.fn().mockResolvedValue([{ email: 'admin@example.com', enabled: true }]),
  } as unknown as Repository<AdminAlertRecipient>;
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('does not contact external services without explicit configuration', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    const service = new AdminAlertsService(
      { get: () => undefined } as unknown as ConfigService,
      recipients,
    );
    await service.bookingRequested(event);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses Acutis Queue email.send with deterministic retry-safe job id', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 202 });
    global.fetch = fetchMock as typeof fetch;
    const config = new Map([
      ['ADMIN_ALERT_EMAIL', 'admin@example.com'],
      ['QUEUE_SERVICE_URL', 'https://queue.internal'],
      ['QUEUE_API_KEY', 'private-test-token'],
    ]);
    const service = new AdminAlertsService(
      {
        get: (key: string) => config.get(key),
      } as ConfigService,
      recipients,
    );
    await service.bookingRequested(event);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://queue.internal/jobs');
    const body = JSON.parse(options.body as string) as {
      queue: string;
      name: string;
      options: { jobId: string };
      data: { to: string; text: string };
    };
    expect(body).toMatchObject({
      queue: 'email',
      name: 'email.send',
      options: { jobId: `moc-maria.booking.${event.appointmentId}` },
    });
    expect(body.data.to).toEqual(['admin@example.com']);
    expect(body.data.text).toContain(event.providerName);
    expect(body.data.text).toContain(event.customerName);
  });
});
