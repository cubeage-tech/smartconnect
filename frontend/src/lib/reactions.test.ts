import { describe, expect, it } from 'vitest';
import { placePopover, toggleReactionLocally } from './reactions';

const me = { id: 'u1', username: 'me' };
const other = { id: 'u2', username: 'other' };

describe('QA L14 — toggleReactionLocally (optimistic reactions)', () => {
  it('adds a new emoji, joins an existing one, and removes my own', () => {
    expect(toggleReactionLocally([], '👍', me)).toEqual([{ emoji: '👍', count: 1, users: [me] }]);
    const joined = toggleReactionLocally([{ emoji: '👍', count: 1, users: [other] }], '👍', me);
    expect(joined).toEqual([{ emoji: '👍', count: 2, users: [other, me] }]);
    expect(toggleReactionLocally(joined, '👍', me)).toEqual([{ emoji: '👍', count: 1, users: [other] }]);
    expect(toggleReactionLocally([{ emoji: '🎉', count: 1, users: [me] }], '🎉', me)).toEqual([]);
  });
});

describe('QA H2 — placePopover keeps the picker fully on screen', () => {
  const viewport = { width: 1470, height: 835 };
  const size = { width: 350, height: 420 };

  it('opens below the button when there is room', () => {
    const box = placePopover({ top: 100, bottom: 130, left: 1240, right: 1270 }, viewport, size);
    expect(box.top).toBe(134);
    expect(box.left + box.width).toBe(1270);
  });

  it('flips above a button near the bottom (recent messages)', () => {
    const box = placePopover({ top: 660, bottom: 690, left: 1240, right: 1270 }, viewport, size);
    expect(box.top + box.height).toBeLessThanOrEqual(660);
    expect(box.top).toBeGreaterThanOrEqual(8);
  });

  it('stays inside the viewport when neither side fits, and on a phone', () => {
    const tight = placePopover({ top: 300, bottom: 330, left: 10, right: 40 }, { width: 1470, height: 600 }, size);
    expect(tight.top).toBeGreaterThanOrEqual(8);
    expect(tight.top + tight.height).toBeLessThanOrEqual(592);
    expect(tight.left).toBe(8);
    const phone = placePopover({ top: 500, bottom: 530, left: 300, right: 330 }, { width: 390, height: 844 }, size);
    expect(phone.width).toBe(350);
    expect(phone.left).toBeGreaterThanOrEqual(8);
    expect(phone.left + phone.width).toBeLessThanOrEqual(382);
    const narrow = placePopover({ top: 500, bottom: 530, left: 200, right: 230 }, { width: 320, height: 568 }, size);
    expect(narrow.width).toBe(304);
    expect(narrow.height).toBeLessThanOrEqual(552);
  });
});
