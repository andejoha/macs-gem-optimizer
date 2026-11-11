/**
 * Coverage for locked rank-1 gems outside the upgrade search: the rank-1
 * conversion predicate, the setup codec's lock bit and the results export.
 */

import { describe, expect, it } from 'vitest';
import { runOptimization } from '../../src/core/api/runOptimization';
import type { GemInfo } from '../../src/types/api';
import type { InventoryGemStack } from '../../src/types/inventory';
import { allStacksToInventoryItems } from '../../src/types/inventory';
import { buildResultCodecState } from '../../src/utils/resultsExport';
import { decodeSetup, encodeSetup } from '../../src/utils/setupCodec';

const GEM_ID = 1001;
const gemById = new Map<number, GemInfo>([[GEM_ID, { id: GEM_ID, name: 'Test', star_rating: 1 } as GemInfo]]);

function stack(partial: Partial<InventoryGemStack>): InventoryGemStack {
  return { id: 'a', gem_id: GEM_ID, star_rating: 1, rank: '1', active_stars: 1, quantity: 1, ...partial };
}

describe('rank-1 conversion', () => {
  it('converts only unlocked copies', () => {
    const response = runOptimization(
      {
        gem_power: 0,
        gem_setup: { head: { gem_id: 5001, target_rank: '3', active_stars: 2 } },
        inventory: [
          { gem_id: GEM_ID, rank: '1', active_stars: 1, locked: true },
          { gem_id: GEM_ID, rank: '1', active_stars: 1 },
        ],
      },
      false,
      true,
      'off',
    );

    expect(response.converted_gems).toEqual([{ gem_id: GEM_ID, quantity: 1, gem_power_gained: 1 }]);
    expect(response.remaining_inventory).toMatchObject([{ gem_id: GEM_ID, locked: true }]);
  });
});

describe('setup codec', () => {
  it('keeps locked and unlocked stacks separate in a round trip', () => {
    const stacks = [stack({ id: 'a', quantity: 2 }), stack({ id: 'b', quantity: 3, locked: true })];
    const decoded = decodeSetup(encodeSetup({ gemSetup: {}, gemPower: 5, stacks }), gemById);

    expect(decoded.stacks.map((s) => [s.quantity, !!s.locked])).toEqual([
      [2, false],
      [3, true],
    ]);
  });

  it('decodes a code written before locking existed as unlocked', () => {
    // Version 1, gem power 5, no slots, one stack: gem 1001, rank 1, 1 active star (no flags), quantity 4.
    const legacy = btoa(String.fromCharCode(1, 0, 5, 0, 1, 0x03, 0xe9, 0, 1, 4))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const decoded = decodeSetup(legacy, gemById);

    expect(decoded.stacks).toMatchObject([{ gem_id: GEM_ID, quantity: 4, dormant: false, locked: false }]);
  });
});

describe('results export', () => {
  it('keeps the lock on a socketed copy so a later run does not convert it', () => {
    const base = { gem_id: 1001, rank: '1', active_stars: 1 };
    const first = runOptimization(
      {
        gem_power: 0,
        gem_setup: { head: { gem_id: 1001, target_rank: '3', active_stars: 1 } },
        inventory: [{ ...base, locked: true }],
      },
      false,
      true,
      'off',
    );
    expect(first.converted_gems).toEqual([]);

    const exported = decodeSetup(encodeSetup(buildResultCodecState(first)), gemById);
    expect(exported.stacks.every((s) => s.locked)).toBe(true);

    const second = runOptimization(
      {
        gem_power: exported.gemPower,
        gem_setup: first.gem_results.head ? { head: { gem_id: 1001, target_rank: '3', active_stars: 1 } } : {},
        inventory: allStacksToInventoryItems(exported.stacks),
      },
      false,
      true,
      'off',
    );
    expect(second.converted_gems).toEqual([]);
  });
});
