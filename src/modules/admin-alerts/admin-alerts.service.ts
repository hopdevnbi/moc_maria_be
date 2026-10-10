import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface BookingAlert {
  appointmentId: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  providerName: string;
  serviceName: string;
  branchName: string;
  startsAt: string;
  totalVnd: string;
  notes: string | null;
}

@Injectable()
export class AdminAlertsService {
  private readonly logger = new Logger(AdminAlertsService.name);
  constructor(private readonly config: ConfigService) {}

  async bookingRequested(alert: BookingAlert): Promise<void> {
    const recipient = this.config.get<string>('ADMIN_ALERT_EMAIL')?.trim();
    const base = this.config.get<string>('QUEUE_SERVICE_URL')?.trim();
    const key = this.config.get<string>('QUEUE_API_KEY')?.trim();
    if (!recipient || !base || !key) {
      this.logger.warn('Booking alert email not configured');
      return;
    }
    const lines = [
      'Mộc Maria - Yêu cầu đặt lịch mới',
      `Mã lịch: ${alert.appointmentId}`,
      `Khách hàng: ${alert.customerName}`,
      `Email khách: ${alert.customerEmail || 'Chưa cung cấp'}`,
      `Số điện thoại: ${alert.customerPhone || 'Chưa cung cấp'}`,
      `KTV: ${alert.providerName}`,
      `Dịch vụ: ${alert.serviceName}`,
      `Cơ sở: ${alert.branchName}`,
      `Thời gian (ISO): ${alert.startsAt}`,
      `Giá dự kiến (VND): ${alert.totalVnd}`,
      `Ghi chú: ${alert.notes || 'Không có'}`,
      'Đăng nhập hệ thống quản trị để xác nhận yêu cầu.',
    ];
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
        body: JSON.stringify({
          queue: 'email',
          name: 'email.send',
          data: {
            to: recipient,
            subject: `[Mộc Maria] Đặt lịch mới ${alert.appointmentId.slice(0, 8)}`,
            text: lines.join('\n'),
            purpose: 'moc-maria-admin-booking',
            correlationId: alert.appointmentId,
          },
          options: { attempts: 5, jobId: `moc-maria.booking.${alert.appointmentId}` },
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`queue HTTP ${response.status}`);
    } catch (error) {
      // Notification failures must never roll back a successfully persisted booking.
      this.logger.error(
        `Could not enqueue booking notification ${alert.appointmentId}: ${error instanceof Error ? error.message : 'unknown failure'}`,
      );
    }
  }
}
