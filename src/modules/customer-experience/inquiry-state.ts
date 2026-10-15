export const INQUIRY_STATES = [
  'PENDING',
  'CONTACTED',
  'CONFIRMED',
  'IN_SERVICE',
  'COMPLETED',
  'DECLINED',
  'CANCELLED',
] as const;
export type InquiryState = (typeof INQUIRY_STATES)[number];

export function appointmentInquiryState(status: string): InquiryState {
  const aliases: Record<string, InquiryState> = {
    REQUESTED: 'PENDING',
    ACCEPTED: 'CONTACTED',
    CUSTOMER_CONFIRMED: 'CONFIRMED',
    CHECKED_IN: 'IN_SERVICE',
    EXPIRED: 'CANCELLED',
    NO_SHOW: 'CANCELLED',
  };
  return aliases[status] ?? (status as InquiryState);
}

export function inquiryState(
  value: {
    status: string;
    appointmentId?: string;
    fulfillmentStatus?: string;
    providerCompletedAt?: string;
  },
  appointmentStatus?: string | null,
): InquiryState {
  if (appointmentStatus) return appointmentInquiryState(appointmentStatus);
  if (value.status === 'CANCELLED' || value.status === 'DECLINED') return value.status;
  if (value.appointmentId && value.fulfillmentStatus)
    return appointmentInquiryState(value.fulfillmentStatus);
  if (value.providerCompletedAt || value.status === 'COMPLETED') return 'COMPLETED';
  return value.status as InquiryState;
}

// Same precedence as inquiryState; aliases are internal SQL identifiers, never user input.
export const inquiryStateSql = `CASE
  WHEN a.status IS NOT NULL THEN CASE a.status
    WHEN 'REQUESTED' THEN 'PENDING' WHEN 'ACCEPTED' THEN 'CONTACTED'
    WHEN 'CUSTOMER_CONFIRMED' THEN 'CONFIRMED' WHEN 'CHECKED_IN' THEN 'IN_SERVICE'
    WHEN 'EXPIRED' THEN 'CANCELLED' WHEN 'NO_SHOW' THEN 'CANCELLED' ELSE a.status END
  WHEN m.value->>'status' IN ('CANCELLED','DECLINED') THEN m.value->>'status'
  WHEN m.value->>'appointmentId' IS NOT NULL AND m.value->>'fulfillmentStatus' IS NOT NULL THEN m.value->>'fulfillmentStatus'
  WHEN m.value->>'providerCompletedAt' IS NOT NULL OR m.value->>'status'='COMPLETED' THEN 'COMPLETED'
  ELSE m.value->>'status' END`;
