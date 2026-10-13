// Generate visual previews locally; no email is sent and no business data is written.
const fs = require('node:fs');
const path = require('node:path');
const { bookingEmail, chatDigestEmail, legacyChatDigestEmail } = require('../dist/shared/email/moc-maria-email');
const output = process.argv[2];
if (!output) throw new Error('Pass an absolute preview output directory');
if (!path.isAbsolute(output)) throw new Error('Preview directory must be absolute');
fs.mkdirSync(output, { recursive: true });
const booking = bookingEmail({
  appointmentId: 'preview-booking', customerName: 'Nguyễn An', customerEmail: 'an@example.com',
  customerPhone: '0900000000', providerName: 'Linh Anh', serviceName: 'Gội đầu sạch',
  branchName: 'Mộc Maria', startsAt: '2026-10-13T08:30:00Z', totalVnd: '49000',
  notes: 'Mong được tư vấn về dịch vụ trước khi đặt lịch.\nXin cảm ơn Mộc Maria.',
});
const text = 'Mộc Maria · Báo cáo hội thoại\nKhách: Nguyễn An\nKTV: Linh Anh\nTin mới từ khách: 2\nTin mới từ KTV: 1';
const digest = chatDigestEmail({ id: 'preview-thread', customer_name: 'Nguyễn An', provider_name: 'Linh Anh', customer_messages: 2, provider_messages: 1, last_at: '2026-10-13T08:30:00Z' }, text);
const legacy = legacyChatDigestEmail('preview-existing-thread', text);
for (const [name, email] of [['booking', booking], ['chat-digest', digest], ['existing-report', legacy]]) {
  fs.writeFileSync(path.join(output, name + '.html'), email.html);
  fs.writeFileSync(path.join(output, name + '.txt'), email.text);
}
console.log('Created three local email previews. No email sent.');
