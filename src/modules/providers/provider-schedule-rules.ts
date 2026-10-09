export interface MinuteWindow {
  startsAtMinute: number;
  endsAtMinute: number;
}

export function overlaps(a: MinuteWindow, b: MinuteWindow): boolean {
  return a.startsAtMinute < b.endsAtMinute && b.startsAtMinute < a.endsAtMinute;
}
export function validCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
export function subtractTimeOff(windows: MinuteWindow[], timeOff: MinuteWindow[]): MinuteWindow[] {
  return timeOff.reduce(
    (remaining, off) =>
      remaining.flatMap((window) => {
        if (!overlaps(window, off)) return [window];
        const result: MinuteWindow[] = [];
        if (off.startsAtMinute > window.startsAtMinute)
          result.push({ startsAtMinute: window.startsAtMinute, endsAtMinute: off.startsAtMinute });
        if (off.endsAtMinute < window.endsAtMinute)
          result.push({ startsAtMinute: off.endsAtMinute, endsAtMinute: window.endsAtMinute });
        return result;
      }),
    windows,
  );
}
