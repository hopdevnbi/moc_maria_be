import { vipLevel } from './vip-level';
describe('Numbered VIP levels', () => {
  it('keeps legacy VIP at level1 and accepts integer levels1 through99', () => {
    for (const value of [undefined, null, 0, -1, 1.5, 100, '3']) expect(vipLevel(value)).toBe(1);
    for (const value of [1, 2, 3, 99]) expect(vipLevel(value)).toBe(value);
  });
});
