import { createHmac } from 'node:crypto';
import { maskVerifiedReferralContact } from './referrals.service';

const secret = 'a'.repeat(40);
const claim = (prefix: string, value: string): string =>
  createHmac('sha256', secret)
    .update(prefix + value)
    .digest('hex');

describe('referral reward contact privacy', () => {
  it('shows only a masked email proven by the recorded HMAC', () => {
    expect(
      maskVerifiedReferralContact(
        'email',
        '  Person.Example@Gmail.com ',
        claim('referral-email:v1:', 'person.example@gmail.com'),
        secret,
      ),
    ).toBe('p***@gmail.com');
  });
  it('shows only the last four digits for a verified phone', () => {
    const phone = '+84967892889';
    expect(
      maskVerifiedReferralContact(
        'sms',
        phone,
        claim('referral-verified-phone:v1:', phone),
        secret,
      ),
    ).toBe('••••••2889');
  });
  it('never leaks a changed contact, missing proof or invalid secret', () => {
    const hashed = claim('referral-email:v1:', 'before@gmail.com');
    expect(maskVerifiedReferralContact('email', 'after@gmail.com', hashed, secret)).toBeNull();
    expect(maskVerifiedReferralContact('email', 'before@gmail.com', null, secret)).toBeNull();
    expect(maskVerifiedReferralContact('email', 'before@gmail.com', hashed, 'short')).toBeNull();
    expect(maskVerifiedReferralContact('email', 'before@gmail.com', 'wrong', secret)).toBeNull();
  });
});
