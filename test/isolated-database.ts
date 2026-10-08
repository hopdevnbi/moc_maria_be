export function requireIsolatedDatabase(): void {
  const url = new URL(process.env['DATABASE_URL'] || 'http://invalid');
  if (
    process.env['NODE_ENV'] !== 'test' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.pathname !== '/moc_maria_qa'
  ) {
    throw new Error(
      'Fixture tests require the isolated moc_maria_qa database over a local tunnel.',
    );
  }
}
