/**
 * End-to-end coverage for bonus mode 'budget' combined with upgrades: a
 * bonus activation freed by the budget pass dropping an upgrade must still
 * be found by the same run. See `bonusBudget.test.ts` for the pass in
 * isolation.
 */

import { describe, expect, it } from 'vitest';
import { runOptimization } from '../../../src/core/api/runOptimization';
import type { GemSetup, InventoryItem, OptimizeRequest } from '../../../src/core/api/types';
import { dormantContribution } from '../../../src/utils/gemPowerCost';

const CUTTHROATS_GRIN = 2007;
const ROILING_CONSEQUENCE_SLOT = 'head';
/** Index of the Roiling Consequence socket that requires Cutthroat's Grin. */
const GRIN_SOCKET_INDEX = 1;

const GEM_SETUP: GemSetup = {
  head: { gem_id: 5018, target_rank: '6', active_stars: 4 },
  chest: { gem_id: 5007, target_rank: '6', active_stars: 3 },
  shoulders: { gem_id: 5024, target_rank: '5', active_stars: 3 },
  legs: { gem_id: 5027, target_rank: '6', active_stars: 5 },
  main_hand: { gem_id: 5023, target_rank: '5', active_stars: 4 },
  off_hand: { gem_id: 5025, target_rank: '5', active_stars: 3 },
  alt_main_hand: { gem_id: 5028, target_rank: '6', active_stars: 5 },
  alt_off_hand: { gem_id: 5010, target_rank: '5', active_stars: 3 },
};

/** [gem_id, rank, active_stars, quantity, dormant?] */
const STACKS: ReadonlyArray<readonly [number, string, number, number, boolean?]> = [
  [1002, '1', 1, 3],
  [1004, '1', 1, 3],
  [1005, '1', 1, 5],
  [1006, '1', 1, 1],
  [1007, '1', 1, 5],
  [1009, '1', 1, 16],
  [1010, '1', 1, 2],
  [1011, '1', 1, 1],
  [1012, '1', 1, 4],
  [1013, '1', 1, 9],
  [1015, '1', 1, 2],
  [1016, '1', 1, 5],
  [1017, '1', 1, 10],
  [1021, '1', 1, 7],
  [1023, '1', 1, 10],
  [1024, '1', 1, 3],
  [1025, '1', 1, 5],
  [1026, '1', 1, 8],
  [1027, '1', 1, 2],
  [1028, '1', 1, 6],
  [1029, '1', 1, 5],
  [1030, '1', 1, 8],
  [2001, '1', 2, 11],
  [2001, '5.4', 2, 1],
  [2003, '1', 2, 4],
  [2003, '4', 2, 1],
  [2003, '6.2', 2, 1],
  [2004, '1', 2, 18],
  [2004, '5', 2, 1, true],
  [2006, '1', 2, 1],
  [2007, '1', 2, 2],
  [2008, '1', 2, 20],
  [2008, '5.2', 2, 1],
  [2009, '1', 2, 10],
  [2009, '5.4', 2, 1],
  [2010, '6.1', 2, 1, true],
  [2011, '1', 2, 9],
  [2011, '6.3', 2, 1, true],
  [2012, '1', 2, 4],
  [2014, '1', 2, 9],
  [2015, '1', 2, 16],
  [2015, '7', 2, 1],
  [2016, '1', 2, 14],
  [2016, '5.2', 2, 1, true],
  [2017, '1', 2, 18],
  [2020, '1', 2, 2],
  [2021, '1', 2, 1],
  [2022, '8', 2, 1],
  [2023, '1', 2, 13],
  [2023, '4.1', 2, 1, true],
  [2025, '1', 2, 7],
  [2025, '5', 2, 1],
  [2025, '6.4', 2, 1],
  [2026, '1', 2, 14],
  [2026, '5.2', 2, 1, true],
  [2028, '1', 2, 12],
  [2028, '4.1', 2, 1, true],
  [2029, '1', 2, 8],
  [2029, '6', 2, 1, true],
  [2031, '1', 2, 12],
  [2031, '5.3', 2, 1, true],
  [2032, '1', 2, 6],
  [2032, '7', 2, 1],
  [2033, '1', 2, 41],
  [2034, '1', 2, 14],
  [2036, '1', 2, 10],
  [5001, '1', 2, 4],
  [5001, '5.1', 2, 1],
  [5002, '1', 2, 2],
  [5003, '1', 2, 1],
  [5003, '5', 5, 1, true],
  [5005, '1', 2, 3],
  [5006, '1', 2, 3],
  [5007, '1', 2, 7],
  [5009, '1', 2, 4],
  [5010, '1', 2, 2],
  [5013, '1', 2, 3],
  [5014, '1', 2, 2],
  [5015, '1', 2, 2],
  [5016, '1', 2, 2],
  [5017, '1', 2, 1],
  [5018, '1', 2, 2],
  [5021, '4.2', 3, 1],
  [5022, '1', 2, 5],
  [5023, '1', 2, 1],
  [5024, '1', 2, 1],
  [5025, '1', 2, 3],
  [5026, '4.4', 2, 1],
  [5027, '1', 2, 7],
  [5028, '1', 2, 12],
  [5029, '1', 2, 3],
  [5029, '6', 4, 1, true],
];

function buildRequest(): OptimizeRequest {
  const stacks = STACKS.map(([gem_id, rank, active_stars, quantity, dormant]) => ({
    gem_id,
    rank,
    active_stars,
    quantity,
    dormant: dormant ?? false,
  }));
  const dormantPower = stacks.reduce((sum, stack) => sum + dormantContribution({ ...stack, star_rating: stack.gem_id >= 5000 ? 5 : 2 }), 0);
  const inventory: InventoryItem[] = stacks.flatMap((stack) =>
    Array.from({ length: stack.quantity }, () => ({
      gem_id: stack.gem_id,
      rank: stack.rank,
      active_stars: stack.active_stars,
      dormant: stack.dormant,
    })),
  );
  return { gem_power: 984 - dormantPower, gem_setup: GEM_SETUP, inventory };
}

describe('runOptimization: bonus mode budget with upgrades', () => {
  it("sockets a spare Cutthroat's Grin once the budget pass has dropped its upgrade", () => {
    const response = runOptimization(buildRequest(), true, true, 'budget');

    const socket = response.gem_results[ROILING_CONSEQUENCE_SLOT]?.sockets[GRIN_SOCKET_INDEX];
    expect(socket?.assigned_gem_id).toBe(CUTTHROATS_GRIN);
    expect(socket?.bonus_activated).toBe(true);
    expect(response.summary.surplus_or_shortfall).toBeGreaterThanOrEqual(0);
  });
});
