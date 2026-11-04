const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const detail = new RegExp(`^/provider-showcase/${uuid}$`, 'i');
const service = /^\/services\/[a-z0-9][a-z0-9-]{0,119}$/;
const stable = new Set([
  '/services',
  '/service-categories',
  '/branches',
  '/provider-display',
  '/provider-presentation',
  '/provider-presentation/profiles',
]);

export function publicCacheTtl(path: string): number | null {
  if (path === '/ktv-chat/providers') return 5000;
  if (stable.has(path) || detail.test(path) || service.test(path)) return 300_000;
  // Eligibility, appointment inventory, bank config and every private endpoint remain live.
  return null;
}
