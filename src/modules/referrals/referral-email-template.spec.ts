import { buildReferralOtpEmail } from './referral-email-verification.service';

describe('referral OTP email markup', () => {
  it.each(['vi', 'en', 'ko', 'ja', 'zh-CN', 'ru'] as const)(
    'renders an accessible, self-contained email in %s',
    (locale) => {
      const html = buildReferralOtpEmail(locale, '012345');
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain('012345');
      expect(html).toContain('Mộc Maria');
      expect(html).toContain('10');
      expect(html).not.toMatch(/<script|<img|https?:\/\//i);
    },
  );

  it('rejects untrusted HTML as an OTP code', () => {
    expect(() => buildReferralOtpEmail('vi', '<script>')).toThrow('Invalid OTP format');
  });
});
