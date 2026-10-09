import { BadRequestException } from '@nestjs/common';
import { validCalendarDate } from '../providers/provider-schedule-rules';
import type { ResourceRequirement } from './entities/booking-variant-setting.entity';
export const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const MINUTE_MS = 60000;
export function localDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
export function instant(date: string, minute: number): Date {
  if (!validCalendarDate(date) || !Number.isInteger(minute) || minute < 0 || minute > 1440)
    throw new BadRequestException('Ngày/giờ Việt Nam không hợp lệ.');
  return new Date(new Date(date + 'T00:00:00+07:00').getTime() + minute * MINUTE_MS);
}
export function plusDays(date: string, days: number): string {
  if (!validCalendarDate(date)) throw new BadRequestException('Ngày không hợp lệ.');
  return new Date(new Date(date + 'T00:00:00Z').getTime() + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (n: number): number => (n * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
export interface Occupancy {
  startsAt: Date;
  endsAt: Date;
  units: number;
}
// Half-open intervals: departure at t frees capacity for arrival at t.
export function peakUsage(rows: Occupancy[], start: Date, end: Date): number {
  const events: Array<{ at: number; delta: number }> = [];
  for (const row of rows) {
    const a = Math.max(start.getTime(), row.startsAt.getTime()),
      b = Math.min(end.getTime(), row.endsAt.getTime());
    if (a < b) events.push({ at: a, delta: row.units }, { at: b, delta: -row.units });
  }
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let count = 0,
    peak = 0;
  for (const event of events) {
    count += event.delta;
    peak = Math.max(peak, count);
  }
  return peak;
}
export function allocateResources(
  requirements: ResourceRequirement[],
  resources: Array<{ id: string; kind: string; capacity: number }>,
  busy: Map<string, Occupancy[]>,
  start: Date,
  end: Date,
): Array<{ resourceId: string; units: number }> | null {
  const allocation: Array<{ resourceId: string; units: number }> = [];
  for (const required of requirements) {
    let left = required.quantity;
    for (const resource of resources
      .filter((r) => r.kind === required.kind)
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const free = Math.max(
          0,
          resource.capacity - peakUsage(busy.get(resource.id) || [], start, end),
        ),
        units = Math.min(left, free);
      if (units) {
        allocation.push({ resourceId: resource.id, units });
        left -= units;
      }
      if (!left) break;
    }
    if (left) return null;
  }
  return allocation;
}
