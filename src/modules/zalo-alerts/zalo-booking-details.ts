import { privateZaloText } from './zalo-message-privacy';
import { isEmail } from 'class-validator';

// Only structured booking data may bypass contact masking. Never pass chat,
// free-form notes or a generic notification as booking details.
export interface ZaloBookingDetails {
  providerPhone?: string | null;
  providerEmail?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  requestedAt?: string;
  address?: string;
  location?: 'AT_BRANCH' | 'AT_HOME';
}

export function bookingDetails(source: ZaloBookingDetails): ZaloBookingDetails {
  const email = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim().length <= 254 && isEmail(v.trim()) ? v.trim() : undefined;
  const phone = (v: unknown): string | undefined =>
    typeof v === 'string' &&
    /^\+?[\d ().-]{7,32}$/.test(v.trim()) &&
    /^\d{7,15}$/.test(v.replace(/\D/g, ''))
      ? v.trim()
      : undefined;
  // Address comes from the booking DTO (max 300 characters), not message text.
  const address =
    typeof source.address === 'string'
      ? source.address
          // eslint-disable-next-line no-control-regex -- Prevent injected notification lines.
          .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
          .trim()
          .slice(0, 300)
      : undefined;
  const date = typeof source.requestedAt === 'string' ? new Date(source.requestedAt) : null;
  return {
    providerPhone: phone(source.providerPhone),
    providerEmail: email(source.providerEmail),
    customerPhone: phone(source.customerPhone),
    customerEmail: email(source.customerEmail),
    requestedAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined,
    address: address || undefined,
    location:
      source.location === 'AT_BRANCH' || source.location === 'AT_HOME'
        ? source.location
        : undefined,
  };
}

export function zaloDeliveryText(delivery: {
  text: string;
  kind?: string;
  booking?: ZaloBookingDetails;
}): string {
  const safe = privateZaloText(delivery.text);
  if (
    delivery.kind !== 'inquiry' ||
    !delivery.booking ||
    !safe.startsWith('Mộc Maria · Yêu cầu đặt lịch mới\n')
  )
    return safe;
  const b = bookingDetails(delivery.booking);
  const time = b.requestedAt
    ? new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(b.requestedAt)) + ' (giờ Việt Nam)'
    : undefined;
  const lines = [
    b.providerPhone && 'SĐT KTV: ' + b.providerPhone,
    b.providerEmail && 'Email KTV: ' + b.providerEmail,
    b.customerPhone && 'SĐT khách: ' + b.customerPhone,
    b.customerEmail && 'Email khách: ' + b.customerEmail,
    time && 'Ngày giờ hẹn: ' + time,
    b.location && 'Hình thức: ' + (b.location === 'AT_HOME' ? 'Tại địa chỉ khách' : 'Tại cơ sở'),
    b.address && 'Địa chỉ đặt lịch: ' + b.address,
  ].filter(Boolean);
  if (!lines.length) return safe;
  const marker = '\nMã yêu cầu: ';
  const i = safe.indexOf(marker);
  return i >= 0
    ? safe.slice(0, i) + '\n' + lines.join('\n') + safe.slice(i)
    : safe + '\n' + lines.join('\n');
}
