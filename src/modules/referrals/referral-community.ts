// Only direct HTTPS Zalo group invitations. Never resolve/fetch this link on the server.
export function normalizeCommunityUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!/^https:\/\/zalo\.me\/g\/[a-zA-Z0-9_-]{1,160}\/?$/.test(value)) return null;
  return value.replace(/\/$/, '');
}
export const COMMUNITY_KEY = 'mocmaria.referral.community.v1';
