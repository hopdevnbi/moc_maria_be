import { overlaps, subtractTimeOff, validCalendarDate } from './provider-schedule-rules';

describe('Provider schedule boundaries', () => {
  it('allows adjacent shifts but rejects an intersecting shift', () => {
    expect(
      overlaps(
        { startsAtMinute: 540, endsAtMinute: 600 },
        { startsAtMinute: 600, endsAtMinute: 660 },
      ),
    ).toBe(false);
    expect(
      overlaps(
        { startsAtMinute: 540, endsAtMinute: 600 },
        { startsAtMinute: 599, endsAtMinute: 660 },
      ),
    ).toBe(true);
  });
  it('subtracts partial time off and retains both remaining windows', () => {
    expect(
      subtractTimeOff(
        [{ startsAtMinute: 540, endsAtMinute: 1080 }],
        [{ startsAtMinute: 720, endsAtMinute: 780 }],
      ),
    ).toEqual([
      { startsAtMinute: 540, endsAtMinute: 720 },
      { startsAtMinute: 780, endsAtMinute: 1080 },
    ]);
  });
  it('treats overlapping leave requests as a union and permits all-day closure', () => {
    expect(
      subtractTimeOff(
        [{ startsAtMinute: 540, endsAtMinute: 1080 }],
        [
          { startsAtMinute: 720, endsAtMinute: 900 },
          { startsAtMinute: 780, endsAtMinute: 1080 },
        ],
      ),
    ).toEqual([{ startsAtMinute: 540, endsAtMinute: 720 }]);
    expect(
      subtractTimeOff(
        [{ startsAtMinute: 540, endsAtMinute: 1080 }],
        [{ startsAtMinute: 0, endsAtMinute: 1440 }],
      ),
    ).toEqual([]);
  });
  it('rejects normalized nonexistent dates and accepts actual leap dates', () => {
    expect(validCalendarDate('2026-02-29')).toBe(false);
    expect(validCalendarDate('2028-02-29')).toBe(true);
    expect(validCalendarDate('2026-13-01')).toBe(false);
    expect(validCalendarDate('2026-1-01')).toBe(false);
  });
});
