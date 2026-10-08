import { BadRequestException } from '@nestjs/common';

export function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}

export function normalizePhone(value: string | null | undefined): string | null {
  const source = value?.trim() ?? '';
  if (!source) return null;

  const compact = source.replace(/[\s().-]/g, '');
  if (/^0\d{8,10}$/.test(compact)) {
    return '+84' + compact.slice(1);
  }
  if (/^84\d{8,10}$/.test(compact)) {
    return '+' + compact;
  }
  if (/^\+\d{8,15}$/.test(compact)) {
    return compact;
  }

  throw new BadRequestException('Số điện thoại không hợp lệ.');
}

export function normalizeIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }
  return normalizePhone(trimmed) ?? trimmed;
}
