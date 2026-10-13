import {
  bookingEmail,
  chatDigestEmail,
  legacyChatDigestEmail,
  mocMariaEmailJob,
  vietnamEmailTime,
} from './moc-maria-email';
import type { BookingAlert } from '../../modules/admin-alerts/admin-alerts.service';

const booking: BookingAlert = {
  appointmentId: '11111111-1111-4111-8111-111111111111',
  customerName: 'Nguyễn An',
  customerEmail: 'an@example.com',
  customerPhone: '0900000000',
  providerName: 'Linh Anh',
  serviceName: 'Gội đầu sạch',
  branchName: 'Mộc Maria',
  startsAt: '2026-10-13T08:30:00Z',
  totalVnd: '49000',
  notes: 'Tư vấn trước khi đặt lịch.\nXin cảm ơn.',
};

describe('Mộc Maria email branding and delivery contract', () => {
  it('uses a dedicated bare email sender accepted by the unchanged shared Queue', () => {
    const content = bookingEmail(booking);
    expect(
      mocMariaEmailJob(content, ['admin@example.com'], 'booking', booking.appointmentId),
    ).toMatchObject({ from: 'no-reply@mocmaria.com', to: ['admin@example.com'], ...content });
    expect(content.html).not.toContain('giangxa.com');
    expect(content.html).toContain('WELLNESS LOUNGE');
    expect(content.html).toContain('https://mocmaria.com/brand/');
    expect(content.html).toContain('@media only screen and (max-width:600px)');
    expect(content.html).toContain('role="presentation"');
  });

  it('renders Vietnamese text with a Unicode-friendly email-safe font across branding and headings', () => {
    const html = bookingEmail(booking).html;
    expect(html).toContain('<html lang="vi"><head><meta charset="UTF-8">');
    expect(html).toContain('Một yêu cầu đặt lịch mới');
    expect(html).toContain('Một chút an yên. Một ngày nhẹ nhàng.');
    expect(html).not.toMatch(/font-family:\s*Georgia/i);
    expect(html.match(/font-family:Arial,Helvetica,Tahoma,sans-serif/g)).toHaveLength(5);
  });

  it('formats appointment time in Vietnam and preserves actual service, price and notes', () => {
    const content = bookingEmail(booking);
    expect(content.text).toContain('15:30 13/10/2026');
    expect(content.text).toContain('49.000 ₫');
    expect(content.html).toContain('Gội đầu sạch');
    expect(content.html).toContain('Tư vấn trước khi đặt lịch.<br>Xin cảm ơn.');
    expect(content.text).toContain(booking.appointmentId);
    expect(content.html).toContain('href="https://mocmaria.com/quan-tri"');
    expect(content.html).not.toContain('/quan-tri/lich-hen');
  });

  it('escapes customer-controlled values in visible text, preheader and HTML title context', () => {
    const malicious = '<img src=x onerror="alert(1)">&\'text';
    const content = bookingEmail({ ...booking, customerName: malicious, notes: malicious });
    expect(content.html).not.toContain(malicious);
    expect(content.html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;text');
    expect(content.text).toContain(malicious);
  });

  it('handles missing details, invalid times and arbitrary amounts without NaN or precision loss', () => {
    expect(vietnamEmailTime('invalid')).toBe('Chưa xác định');
    const missing = bookingEmail({
      ...booking,
      customerEmail: null,
      customerPhone: null,
      notes: null,
      totalVnd: 'invalid',
      startsAt: 'invalid',
    });
    expect(missing.html).toContain('Chưa cung cấp');
    expect(missing.html).toContain('Không có ghi chú.');
    expect(missing.html).not.toContain('NaN');
    expect(bookingEmail({ ...booking, totalVnd: '9007199254740993' }).text).toContain(
      '9.007.199.254.740.993 ₫',
    );
  });

  it('renders per-thread counts, names and last activity without requiring message bodies', () => {
    const content = chatDigestEmail(
      {
        id: 'thread-123',
        customer_name: 'An & Bình',
        provider_name: '<KTV>',
        customer_messages: 2,
        provider_messages: 0,
        last_at: '2026-10-13T08:30:00Z',
      },
      'Bản tổng hợp đã lưu',
    );
    expect(content.html).toContain('An &amp; Bình');
    expect(content.html).toContain('&lt;KTV&gt;');
    expect(content.html).toContain('Tin mới từ khách');
    expect(content.html).toContain('Tin mới từ KTV');
    expect(content.html).toContain('15:30 13/10/2026');
    expect(content.html).toContain('https://mocmaria.com/quan-tri/thong-bao');
    expect(content.text).toBe('Bản tổng hợp đã lưu');
  });

  it('supports durable plain-text reports queued before the template release', () => {
    const content = legacyChatDigestEmail('old-thread', 'Khách: An\nTin mới: 2\n<KTV>');
    expect(content.html).toContain('Khách: An<br>Tin mới: 2<br>&lt;KTV&gt;');
    expect(content.text).toBe('Khách: An\nTin mới: 2\n<KTV>');
    expect(mocMariaEmailJob(content, 'admin@example.com', 'digest', 'old-thread').from).toBe(
      'no-reply@mocmaria.com',
    );
  });
});
