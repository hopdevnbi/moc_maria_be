export const LOCALES = ['vi', 'en', 'ko', 'ja', 'zh-CN', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'vi';
export const LOCALE_COOKIE = 'moc_locale';

const COUNTRIES: Readonly<Record<string, Locale>> = {
  VN: 'vi',
  US: 'en',
  GB: 'en',
  CA: 'en',
  AU: 'en',
  NZ: 'en',
  IE: 'en',
  SG: 'en',
  KR: 'ko',
  JP: 'ja',
  CN: 'zh-CN',
  RU: 'ru',
};

export function normalizeLocale(input: unknown): Locale | undefined {
  if (typeof input !== 'string') return undefined;
  return LOCALES.find((locale) => locale.toLowerCase() === input.trim().toLowerCase());
}

/** Country is an approximate hint from a verified edge, never user authorization. */
export function localeForCountry(country: unknown): Locale {
  if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country.trim())) {
    return DEFAULT_LOCALE;
  }
  const code = country.trim().toUpperCase();
  return COUNTRIES[code] ?? DEFAULT_LOCALE;
}

export function resolveLocale(input: {
  manual?: unknown;
  account?: unknown;
  country?: unknown;
}): Locale {
  return (
    normalizeLocale(input.manual) ??
    normalizeLocale(input.account) ??
    localeForCountry(input.country)
  );
}
