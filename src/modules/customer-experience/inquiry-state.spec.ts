import { inquiryState, appointmentInquiryState } from './inquiry-state';

describe('Inquiry lifecycle precedence', () => {
  it('recognizes legacy completion reports without overriding an explicit cancellation', () => {
    const value = { status: 'CONTACTED', providerCompletedAt: new Date().toISOString() };
    expect(inquiryState(value)).toBe('COMPLETED');
    expect(inquiryState({ ...value, status: 'CANCELLED' })).toBe('CANCELLED');
  });
  it('trusts the real linked appointment over stale inquiry metadata', () => {
    expect(
      inquiryState(
        { status: 'CANCELLED', appointmentId: 'id', fulfillmentStatus: 'CONFIRMED' },
        'COMPLETED',
      ),
    ).toBe('COMPLETED');
    expect(appointmentInquiryState('CHECKED_IN')).toBe('IN_SERVICE');
    expect(appointmentInquiryState('EXPIRED')).toBe('CANCELLED');
  });
});
