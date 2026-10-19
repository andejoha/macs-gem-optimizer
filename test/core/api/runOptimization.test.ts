/**
 * End-to-end coverage for `runOptimization`: feasibility of a full player
 * setup with upgrades enabled, and `activated_dormant_gems` reporting: gems the player marked dormant on input that the optimizer
 * assigned to a socket this run. See `converters.test.ts` for
 * `domainToResponse`-level coverage of the tally itself, and
 * `upgrades.test.ts` for the one InventoryGem-reconstruction site
 * (`buildUpgradeChains`'s target-advance step) that must carry `dormant`
 * forward explicitly.
 */

import { describe, expect, it } from 'vitest';
import { runOptimization } from '../../../src/core/api/runOptimization';
import type { InventoryItem, OptimizeRequest } from '../../../src/core/api/types';

describe('runOptimization: activated_dormant_gems', () => {
  it('reports a dormant-marked copy assigned to a socket by the greedy pass (no upgrades)', () => {
    const request: OptimizeRequest = {
      gem_power: 10_000,
      gem_setup: { head: { gem_id: 5001, target_rank: '6', active_stars: 2 } },
      inventory: [{ gem_id: 5001, rank: '6', active_stars: 2, dormant: true }],
    };

    const response = runOptimization(request, false, false, 'off');

    expect(response.gem_results.head?.sockets[3].assigned_gem_id).toBe(5001);
    expect(response.activated_dormant_gems).toEqual([
      { gem_id: 5001, star_rating: 5, rank: '6', active_stars: 2, quantity: 1, gem_power_cost: 850 },
    ]);
  });

  it('keeps dormant provenance across the upgrade depth walk', () => {
    // Only 4 spare rank-"1" copies of the main gem's own type exist, all
    // dormant on input; buildUpgradeChains picks the highest-contribution
    // copy as the chain target and (at whatever depth the search settles
    // on) it remains the sole candidate for the socket, so it gets
    // assigned regardless of the exact depth chosen.
    const request: OptimizeRequest = {
      gem_power: 5_000,
      gem_setup: { head: { gem_id: 5001, target_rank: '6', active_stars: 2 } },
      inventory: Array.from({ length: 4 }, () => ({ gem_id: 5001, rank: '1', active_stars: 2, dormant: true })),
    };

    const response = runOptimization(request, true, false, 'off');

    expect(response.gem_results.head?.sockets[3].assigned_gem_id).toBe(5001);
    const activated = response.activated_dormant_gems.find((g) => g.gem_id === 5001);
    expect(activated?.quantity).toBe(1);
  });
});

/** Expands `[gemId, rank, activeStars, quantity, dormant]` stacks into one inventory item per copy. */
function expandStacks(stacks: ReadonlyArray<[number, string, number, number, boolean]>): InventoryItem[] {
  return stacks.flatMap(([gemId, rank, activeStars, quantity, dormant]) =>
    Array.from({ length: quantity }, () => ({ gem_id: gemId, rank, active_stars: activeStars, dormant })),
  );
}

describe('runOptimization: feasibility with upgrades', () => {
  // A full player setup that is feasible: the same setup with shoulders at
  // rank "5" leaves 86 surplus, and raising it to "5.1" costs only 60 more.
  // gem_power is the player's 973 minus the 2310 stored in dormant gems,
  // exactly as HomePage sends it.
  const request: OptimizeRequest = {
    gem_power: -1337,
    gem_setup: {
      head: { gem_id: 5018, target_rank: '6', active_stars: 4 },
      chest: { gem_id: 5007, target_rank: '6', active_stars: 3 },
      shoulders: { gem_id: 5024, target_rank: '5.1', active_stars: 3 },
      legs: { gem_id: 5027, target_rank: '6', active_stars: 5 },
      main_hand: { gem_id: 5023, target_rank: '5', active_stars: 4 },
      off_hand: { gem_id: 5025, target_rank: '5', active_stars: 3 },
      alt_main_hand: { gem_id: 5028, target_rank: '6', active_stars: 5 },
      alt_off_hand: { gem_id: 5010, target_rank: '5', active_stars: 3 },
    },
    inventory: expandStacks([
      [1002, '1', 1, 3, false],
      [1004, '1', 1, 3, false],
      [1005, '1', 1, 3, false],
      [1007, '1', 1, 5, false],
      [1009, '1', 1, 10, false],
      [1010, '1', 1, 2, false],
      [1011, '1', 1, 1, false],
      [1012, '1', 1, 3, false],
      [1013, '1', 1, 7, false],
      [1015, '1', 1, 1, false],
      [1016, '1', 1, 5, false],
      [1017, '1', 1, 8, false],
      [1021, '1', 1, 4, false],
      [1023, '1', 1, 10, false],
      [1024, '1', 1, 3, false],
      [1025, '1', 1, 4, false],
      [1026, '1', 1, 4, false],
      [1027, '1', 1, 2, false],
      [1028, '1', 1, 6, false],
      [1029, '1', 1, 5, false],
      [1030, '1', 1, 5, false],
      [2001, '1', 2, 10, false],
      [2001, '5.4', 2, 1, false],
      [2003, '1', 2, 3, false],
      [2003, '4', 2, 1, false],
      [2003, '6.2', 2, 1, false],
      [2004, '1', 2, 16, false],
      [2004, '5', 2, 1, true],
      [2008, '1', 2, 18, false],
      [2008, '5.2', 2, 1, false],
      [2009, '1', 2, 10, false],
      [2009, '5.4', 2, 1, false],
      [2010, '6.1', 2, 1, true],
      [2011, '1', 2, 9, false],
      [2011, '6.3', 2, 1, true],
      [2012, '1', 2, 4, false],
      [2014, '1', 2, 9, false],
      [2015, '1', 2, 16, false],
      [2015, '7', 2, 1, false],
      [2016, '1', 2, 14, false],
      [2016, '5.2', 2, 1, true],
      [2017, '1', 2, 14, false],
      [2022, '8', 2, 1, false],
      [2023, '1', 2, 13, false],
      [2023, '4.1', 2, 1, true],
      [2025, '1', 2, 7, false],
      [2025, '5', 2, 1, false],
      [2025, '6.4', 2, 1, false],
      [2026, '1', 2, 14, false],
      [2026, '5.2', 2, 1, true],
      [2028, '1', 2, 12, false],
      [2028, '4.1', 2, 1, true],
      [2029, '1', 2, 8, false],
      [2029, '6', 2, 1, true],
      [2031, '1', 2, 12, false],
      [2031, '5.3', 2, 1, true],
      [2032, '1', 2, 6, false],
      [2032, '7', 2, 1, false],
      [2033, '1', 2, 41, false],
      [2034, '1', 2, 14, false],
      [2036, '1', 2, 7, false],
      [5001, '1', 2, 4, false],
      [5001, '5.1', 2, 1, false],
      [5002, '1', 2, 2, false],
      [5003, '1', 2, 3, false],
      [5003, '5', 5, 1, true],
      [5005, '1', 2, 3, false],
      [5006, '1', 2, 3, false],
      [5007, '1', 2, 7, false],
      [5009, '1', 2, 4, false],
      [5010, '1', 2, 2, false],
      [5013, '1', 2, 3, false],
      [5014, '1', 2, 2, false],
      [5015, '1', 2, 2, false],
      [5016, '1', 2, 2, false],
      [5017, '1', 2, 1, false],
      [5018, '1', 2, 1, false],
      [5021, '4.2', 3, 1, false],
      [5022, '1', 2, 5, false],
      [5023, '1', 2, 1, false],
      [5024, '1', 2, 1, false],
      [5025, '1', 2, 3, false],
      [5026, '4.4', 2, 1, false],
      [5027, '1', 2, 7, false],
      [5028, '1', 2, 12, false],
      [5029, '1', 2, 1, false],
      [5029, '6', 4, 1, true],
    ]),
  };

  it('stays feasible when filled sockets would otherwise forfeit dormant power', () => {
    const response = runOptimization(request, true, true, 'off');

    expect(response.summary.status).toBe('feasible');
  });

  it('stays feasible without rank-1 conversion covering an overstated dormant power estimate', () => {
    const response = runOptimization(request, true, false, 'off');

    expect(response.summary.status).toBe('feasible');
  });
});
