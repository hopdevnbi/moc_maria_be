import type { QueryRunner } from 'typeorm';
import { CatalogTranslations1795068000000 } from './1795068000000-CatalogTranslations';
describe('catalog translation migration', () => {
  it('adds private FK tables, locale/version constraints and revision triggers', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new CatalogTranslations1795068000000().up({ query } as unknown as QueryRunner);
    const sql = query.mock.calls.map(([s]) => String(s)).join('\n');
    for (const [table, parent] of [
      ['category', 'service_categories'],
      ['service', 'services'],
      ['variant', 'service_variants'],
    ]) {
      const name = 'public.moc_' + table + '_translations';
      expect(sql).toContain('CREATE TABLE ' + name);
      expect(sql).toContain('REFERENCES public.' + parent + '(id)');
      expect(sql).toContain('ALTER TABLE ' + name + ' ENABLE ROW LEVEL SECURITY');
      expect(sql).toContain('REVOKE ALL ON TABLE ' + name + ' FROM PUBLIC, anon, authenticated');
      expect(sql).toContain(
        'ON ' + name + ' FOR EACH STATEMENT EXECUTE FUNCTION moc_cache.touch_public_revision()',
      );
    }
    expect(sql).toContain('PRIMARY KEY(entity_id,locale)');
    expect(sql).toContain("locale IN ('en','ko','ja','zh-CN','ru')");
  });
  it('refuses destructive rollback if any translations exist', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ present: false }])
      .mockResolvedValueOnce([{ present: true }]);
    await expect(
      new CatalogTranslations1795068000000().down({ query } as unknown as QueryRunner),
    ).rejects.toThrow('Preserve saved');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('DROP TABLE'))).toBe(false);
  });
});
