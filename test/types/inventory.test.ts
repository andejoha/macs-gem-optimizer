/**
 * Tests splitStacksAboveRankOne/sourceStackId (src/types/inventory.ts), which
 * let each copy of a stack above rank 1 be edited/reactivated individually
 * in the inventory grid instead of being locked behind a shared quantity.
 * Rank 1 can't be made dormant at all (see rankUtils.canBeDormant) and
 * always stays merged, regardless of star rating or dormant status.
 */

import { describe, expect, it } from 'vitest';
import type { InventoryGemStack } from '../../src/types/inventory';
import { splitStacksAboveRankOne, sourceStackId } from '../../src/types/inventory';

// Rank "4" is above rank 1 (splittable) by default; individual tests
// override rank to exercise the rank-1 (always-merged) case.
function stack(partial: Partial<InventoryGemStack> & Pick<InventoryGemStack, 'id' | 'quantity'>): InventoryGemStack {
  return { gem_id: 5001, star_rating: 5, rank: '4', active_stars: 2, ...partial };
}

describe('splitStacksAboveRankOne', () => {
  it('leaves a rank-1 stack untouched regardless of quantity or dormant status', () => {
    const s = stack({ id: 'a', quantity: 3, rank: '1' });
    expect(splitStacksAboveRankOne([s])).toEqual([s]);

    const dormantRankOne = stack({ id: 'b', quantity: 3, rank: '1', dormant: true });
    expect(splitStacksAboveRankOne([dormantRankOne])).toEqual([dormantRankOne]);
  });

  it('leaves a rank-1 stack untouched regardless of star rating', () => {
    const s = stack({ id: 'a', quantity: 2, rank: '1', star_rating: 2 });
    expect(splitStacksAboveRankOne([s])).toEqual([s]);
  });

  it('leaves an above-rank-1 stack with quantity 1 untouched', () => {
    const s = stack({ id: 'a', quantity: 1 });
    expect(splitStacksAboveRankOne([s])).toEqual([s]);
  });

  it('splits an above-rank-1 stack with quantity > 1, dormant or not', () => {
    const dormant = stack({ id: 'a', quantity: 3, dormant: true });
    const result = splitStacksAboveRankOne([dormant]);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.quantity === 1 && r.dormant === true)).toBe(true);
    expect(result.map((r) => r.id)).toEqual(['a::0', 'a::1', 'a::2']);

    const active = stack({ id: 'b', quantity: 2 });
    expect(splitStacksAboveRankOne([active])).toHaveLength(2);
  });

  it('only splits the above-rank-1 stacks in a mixed list', () => {
    const rankOne = stack({ id: 'a', quantity: 2, rank: '1' });
    const dormant = stack({ id: 'b', quantity: 2, dormant: true, gem_id: 5002 });
    const active = stack({ id: 'c', quantity: 2, gem_id: 5003 });
    const result = splitStacksAboveRankOne([rankOne, dormant, active]);
    expect(result).toEqual([
      rankOne,
      { ...dormant, id: 'b::0', quantity: 1 },
      { ...dormant, id: 'b::1', quantity: 1 },
      { ...active, id: 'c::0', quantity: 1 },
      { ...active, id: 'c::1', quantity: 1 },
    ]);
  });
});

describe('sourceStackId', () => {
  it('returns the id unchanged when it is not a split id', () => {
    expect(sourceStackId('a')).toBe('a');
  });

  it('strips the split suffix to recover the source id', () => {
    expect(sourceStackId('a::0')).toBe('a');
    expect(sourceStackId('a::12')).toBe('a');
  });
});
