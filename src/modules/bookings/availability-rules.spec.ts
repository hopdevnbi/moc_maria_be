import {
  allocateResources,
  distanceKm,
  instant,
  localDate,
  peakUsage,
  plusDays,
} from './availability-rules';
describe('Booking time and capacity boundaries', () => {
  it('converts Vietnamese midnight and year boundaries without host timezone', () => {
    expect(instant('2026-12-31', 0).toISOString()).toBe('2026-12-30T17:00:00.000Z');
    expect(instant('2026-12-31', 1440).toISOString()).toBe('2026-12-31T17:00:00.000Z');
    expect(localDate(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01');
    expect(plusDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(() => instant('2026-02-30', 540)).toThrow();
  });
  const start = instant('2026-10-12', 540),
    middle = instant('2026-10-12', 600),
    end = instant('2026-10-12', 660);
  it('does not sum reservations that use capacity at different times', () => {
    expect(
      peakUsage(
        [
          { startsAt: start, endsAt: middle, units: 1 },
          { startsAt: middle, endsAt: end, units: 1 },
        ],
        start,
        end,
      ),
    ).toBe(1);
    expect(
      peakUsage(
        [
          { startsAt: start, endsAt: end, units: 1 },
          { startsAt: middle, endsAt: end, units: 1 },
        ],
        start,
        end,
      ),
    ).toBe(2);
  });
  it('allocates each required resource kind deterministically and fails closed when capacity is insufficient', () => {
    const resources = [
      { id: 'b', kind: 'ROOM', capacity: 1 },
      { id: 'a', kind: 'ROOM', capacity: 2 },
      { id: 'c', kind: 'EQUIPMENT', capacity: 1 },
    ];
    const busy = new Map([['a', [{ startsAt: start, endsAt: end, units: 1 }]]]);
    expect(
      allocateResources(
        [
          { kind: 'ROOM', quantity: 2 },
          { kind: 'EQUIPMENT', quantity: 1 },
        ],
        resources,
        busy,
        start,
        end,
      ),
    ).toEqual([
      { resourceId: 'a', units: 1 },
      { resourceId: 'b', units: 1 },
      { resourceId: 'c', units: 1 },
    ]);
    expect(
      allocateResources([{ kind: 'ROOM', quantity: 3 }], resources, busy, start, end),
    ).toBeNull();
    expect(allocateResources([], [], new Map(), start, end)).toEqual([]);
  });
  it('measures the configured geographic radius without accepting unrelated coordinates', () => {
    expect(distanceKm(21, 105, 21, 105)).toBe(0);
    expect(distanceKm(21, 105, 21.01, 105)).toBeGreaterThan(1);
    expect(distanceKm(21, 105, 21.01, 105)).toBeLessThan(1.2);
  });
});
