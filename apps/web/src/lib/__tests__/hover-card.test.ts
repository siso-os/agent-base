// @ts-nocheck — Vitest globals follow the existing unit suite convention.
import { CARD_MARGIN, placeCard } from '../../../../../packages/siso-shell/src/HoverCard';

describe('peek placement', () => {
  it('keeps both edges inside narrow and desktop windows', () => {
    for (const vw of [390, 1440]) for (const left of [0, vw - 42]) for (const top of [0, 860]) {
      const width = Math.min(360, vw - 2 * CARD_MARGIN);
      const result = placeCard({ left, right: left + 42, top, bottom: top + 42 }, width, 1200, vw, 900);
      expect(result.left).toBeGreaterThanOrEqual(CARD_MARGIN);
      expect(result.left + width).toBeLessThanOrEqual(vw - CARD_MARGIN);
      expect(result.top).toBeGreaterThanOrEqual(CARD_MARGIN);
      expect(result.top + result.maxHeight).toBeLessThanOrEqual(900 - CARD_MARGIN);
    }
  });
  it('prefers the requested left side when there is room', () => {
    expect(placeCard({ left: 700, right: 742, top: 100, bottom: 142 }, 300, 100, 1440, 900, 'left').left).toBe(390);
  });
});

 describe('narrow peeks leave the trigger clickable', () => {
  it('sits below a top-bar chip when neither side fits', () => {
    const result = placeCard({ left: 180, right: 270, top: 4, bottom: 44 }, 360, 600, 390, 900);
    expect(result.top).toBe(54);
    expect(result.maxHeight).toBe(838);
  });
  it('sits above a bottom chip and constrains tall content', () => {
    const result = placeCard({ left: 180, right: 270, top: 820, bottom: 864 }, 360, 1200, 390, 900);
    expect(result.top).toBe(8);
    expect(result.maxHeight).toBe(802);
  });
});
