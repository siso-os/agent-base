// @ts-nocheck
import { compactDialValue } from '../../../../../packages/siso-composer/src/compact-dial';
describe('compaction dial', () => {
  it('clamps the full 10–90 range and handles unavailable input', () => {
    expect([-5,10,35,90,95,NaN].map(n => compactDialValue(n))).toEqual([10,10,35,90,90,35]);
  });
  it('snaps pointer movement to five while arrows keep one-percent precision', () => {
    expect([31,32,33,49,51,53].map(n => compactDialValue(n,5))).toEqual([30,30,35,50,50,55]);
    expect([29,30,31,49,50,51].map(n => compactDialValue(n))).toEqual([29,30,31,49,50,51]);
  });
});
