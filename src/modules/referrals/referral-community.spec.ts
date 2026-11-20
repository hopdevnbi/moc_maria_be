import { normalizeCommunityUrl } from './referral-community';
describe('community invitation URLs', () => {
  it('allows the exact Zalo HTTPS group path', () => {
    expect(normalizeCommunityUrl(' https://zalo.me/g/TestOnly123/ ')).toBe(
      'https://zalo.me/g/TestOnly123',
    );
  });
  it.each([
    null,
    '',
    'http://zalo.me/g/test',
    'https://zalo.me.evil.example/g/test',
    'https://zalo.me@evil.example/g/test',
    'https://zalo.me/g/test?phone=123',
    'https://zalo.me/g/test#x',
    'https://zalo.me/g/../test',
    'https://zalo.me/g/%2fabc',
    'javascript:alert(1)',
    'https://zalo.me:443/g/test',
  ])('rejects unsafe or missing input %s', (value) => {
    expect(normalizeCommunityUrl(value)).toBeNull();
  });
});
