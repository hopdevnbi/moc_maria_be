import type { BookingAlert } from '../../modules/admin-alerts/admin-alerts.service';

export const MOC_MARIA_EMAIL_FROM = 'no-reply@mocmaria.com';
const site = 'https://mocmaria.com';
const logo = `${site}/brand/moc-maria-official-20261013.png?v=c65b57b1d14d`;

interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface ChatEmailSummary {
  id: string;
  customer_name: string;
  provider_name: string;
  customer_messages: number;
  provider_messages: number;
  last_at: string;
}

/** Every Mộc Maria job explicitly overrides the shared Queue's sender. */
export function mocMariaEmailJob(
  content: EmailContent,
  to: string | string[],
  purpose: string,
  correlationId: string,
): EmailContent & { to: string | string[]; from: string; purpose: string; correlationId: string } {
  return { ...content, to, from: MOC_MARIA_EMAIL_FROM, purpose, correlationId };
}

const escape = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });

export function vietnamEmailTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Chưa xác định';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hourCycle: 'h23',
  }).format(date);
}

function detailRows(rows: [string, string][]): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows
    .map(
      ([label, value]) =>
        `<tr><td width="35%" valign="top" style="padding:12px 14px;border-bottom:1px solid #e3e8dc;font-size:13px;color:#68796c">${escape(label)}</td><td valign="top" style="padding:12px 14px;border-bottom:1px solid #e3e8dc;font-size:14px;color:#244331;font-weight:600;overflow-wrap:anywhere;word-break:break-word">${escape(value)}</td></tr>`,
    )
    .join('')}</table>`;
}

function emailLayout(input: {
  title: string;
  preheader: string;
  category: string;
  introduction: string;
  body: string;
  actionLabel: string;
  actionPath: string;
  reference: string;
}): string {
  const action = site + input.actionPath;
  return `<!doctype html>
<html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(input.title)} · Mộc Maria</title>
<style>@media only screen and (max-width:600px){.outer{padding:16px 8px!important}.content{padding:24px 18px!important}.headline{font-size:28px!important}.brand{padding:24px 18px!important}.cta{display:block!important;text-align:center!important}}</style></head>
<body style="margin:0;padding:0;background:#f4f5ee;font-family:Arial,Helvetica,sans-serif;color:#244331">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escape(input.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5ee"><tr><td class="outer" align="center" style="padding:36px 16px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fffef9;border:1px solid #dfe5d7;border-radius:20px;overflow:hidden">
<tr><td class="brand" style="padding:28px 32px;background:#edf1e5;border-bottom:1px solid #dfe5d7">
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td width="72" valign="middle"><a href="${site}"><img src="${logo}" width="64" height="64" alt="Logo Mộc Maria" style="display:block;border:0;width:64px;height:64px"></a></td><td valign="middle"><a href="${site}" style="font-family:Georgia,serif;font-size:25px;font-weight:bold;line-height:30px;color:#244331;text-decoration:none">Mộc Maria</a><div style="margin-top:5px;font-size:10px;letter-spacing:2px;color:#927231;font-weight:bold">WELLNESS LOUNGE</div></td></tr></table>
</td></tr>
<tr><td class="content" style="padding:32px">
<div style="font-size:11px;letter-spacing:1.6px;color:#927231;font-weight:bold;text-transform:uppercase">${escape(input.category)}</div>
<h1 class="headline" style="font-family:Georgia,serif;font-size:32px;font-weight:normal;line-height:1.2;margin:12px 0 16px;color:#244331">${escape(input.title)}</h1>
<p style="font-size:15px;line-height:1.7;margin:0 0 24px;color:#68796c">${escape(input.introduction)}</p>
${input.body}
<table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="margin-top:28px"><tr><td><a class="cta" href="${escape(action)}" style="display:inline-block;background:#2e583f;border:1px solid #2e583f;border-radius:10px;padding:15px 22px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;mso-padding-alt:15px 22px">${escape(input.actionLabel)} &rarr;</a></td></tr></table>
<p style="font-size:12px;line-height:1.7;color:#68796c;margin:16px 0 0">Nếu nút không mở được, truy cập:<br><a href="${escape(action)}" style="color:#2e583f;overflow-wrap:anywhere;word-break:break-word">${escape(action)}</a></p>
<p style="font-size:11px;line-height:1.6;color:#889184;margin:24px 0 0;overflow-wrap:anywhere;word-break:break-word">Mã tham chiếu: ${escape(input.reference)}</p>
</td></tr>
<tr><td align="center" style="padding:24px 24px;background:#edf1e5;border-top:1px solid #dfe5d7"><p style="font-family:Georgia,serif;font-size:17px;margin:0;color:#2e583f">Một chút an yên. Một ngày nhẹ nhàng.</p><p style="font-size:12px;line-height:1.7;color:#68796c;margin:10px 0 0">Thông báo tự động từ Mộc Maria · Vui lòng không trả lời email này.<br><a href="${site}" style="color:#2e583f;text-decoration:none">mocmaria.com</a></p></td></tr>
</table></td></tr></table></body></html>`;
}

export function bookingEmail(alert: BookingAlert): EmailContent {
  const time = vietnamEmailTime(alert.startsAt);
  const price = /^\d+$/.test(alert.totalVnd)
    ? `${BigInt(alert.totalVnd).toLocaleString('vi-VN')} ₫`
    : 'Chưa xác định';
  const rows: [string, string][] = [
    ['Khách hàng', alert.customerName],
    ['Email khách', alert.customerEmail || 'Chưa cung cấp'],
    ['Số điện thoại', alert.customerPhone || 'Chưa cung cấp'],
    ['Kỹ thuật viên', alert.providerName],
    ['Dịch vụ', alert.serviceName],
    ['Cơ sở', alert.branchName],
    ['Thời gian (giờ Việt Nam)', time],
    ['Giá dự kiến', price],
  ];
  const url = `${site}/quan-tri`;
  return {
    subject: `[Mộc Maria] Đặt lịch mới ${alert.appointmentId.slice(0, 8)}`,
    text: [
      'Mộc Maria · Yêu cầu đặt lịch mới',
      ...rows.map(([label, value]) => `${label}: ${value}`),
      `Ghi chú: ${alert.notes || 'Không có'}`,
      `Mã lịch: ${alert.appointmentId}`,
      'Đăng nhập hệ thống quản trị để kiểm tra và xác nhận yêu cầu.',
      url,
    ].join('\n'),
    html: emailLayout({
      title: 'Một yêu cầu đặt lịch mới',
      category: 'Quản trị · Đặt lịch',
      preheader: `${alert.customerName} vừa gửi yêu cầu ${alert.serviceName} cùng ${alert.providerName}.`,
      introduction:
        'Khách hàng vừa gửi yêu cầu đặt lịch. Vui lòng kiểm tra thông tin và xử lý yêu cầu trong hệ thống quản trị.',
      body: `${detailRows(rows)}<div style="margin-top:20px;padding:18px;background:#f4f5ee;border-radius:12px"><div style="font-size:12px;color:#927231;font-weight:bold;margin-bottom:8px">GHI CHÚ TỪ KHÁCH</div><div style="font-size:14px;line-height:1.7;color:#244331;overflow-wrap:anywhere;word-break:break-word">${escape(alert.notes || 'Không có ghi chú.').replace(/\r?\n/g, '<br>')}</div></div>`,
      actionLabel: 'Mở trang quản trị',
      actionPath: '/quan-tri',
      reference: alert.appointmentId,
    }),
  };
}

export function chatDigestEmail(summary: ChatEmailSummary, text: string): EmailContent {
  const rows: [string, string][] = [
    ['Khách hàng', summary.customer_name],
    ['Kỹ thuật viên', summary.provider_name],
    ['Tin mới từ khách', String(summary.customer_messages)],
    ['Tin mới từ KTV', String(summary.provider_messages)],
    ['Hoạt động gần nhất (giờ Việt Nam)', vietnamEmailTime(summary.last_at)],
  ];
  return {
    subject: `[Mộc Maria] Báo cáo chat ${summary.id.slice(0, 8)}`,
    text,
    html: emailLayout({
      title: 'Báo cáo hội thoại',
      category: 'Quản trị · Báo cáo hội thoại',
      preheader: `${summary.customer_name} và ${summary.provider_name}: ${summary.customer_messages + summary.provider_messages} tin nhắn mới.`,
      introduction:
        'Hội thoại có hoạt động mới trong kỳ báo cáo. Dưới đây là thông tin tổng hợp để bạn theo dõi và hỗ trợ kịp thời.',
      body: `${detailRows(rows)}<p style="font-size:12px;line-height:1.7;color:#68796c;margin:20px 0 0">Báo cáo chỉ gồm thông tin tổng hợp, không chứa nội dung tin nhắn riêng tư của khách và KTV.</p>`,
      actionLabel: 'Mở trang thông báo',
      actionPath: '/quan-tri/thong-bao',
      reference: summary.id,
    }),
  };
}

/** Pending reports created before this release still get the new brand and sender. */
export function legacyChatDigestEmail(threadId: string, text: string): EmailContent {
  return {
    subject: `[Mộc Maria] Báo cáo chat ${threadId.slice(0, 8)}`,
    text,
    html: emailLayout({
      title: 'Báo cáo hội thoại',
      category: 'Quản trị · Báo cáo hội thoại',
      preheader: 'Thông tin tổng hợp hội thoại Khách–KTV từ Mộc Maria.',
      introduction: 'Vui lòng kiểm tra báo cáo và theo dõi hội thoại trong hệ thống quản trị.',
      body: `<div style="padding:18px;background:#f4f5ee;border-radius:12px;font-size:14px;line-height:1.8;overflow-wrap:anywhere;word-break:break-word">${escape(text).replace(/\r?\n/g, '<br>')}</div>`,
      actionLabel: 'Mở trang thông báo',
      actionPath: '/quan-tri/thong-bao',
      reference: threadId,
    }),
  };
}
